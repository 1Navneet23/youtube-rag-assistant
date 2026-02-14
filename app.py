from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional
import logging
import re
from datetime import datetime
import time

# Project modules
from transcripts.fetch_transcript import youtube_transcripts
from processing.split_text import text_splitter
from vectorstore.create_vectorstore import create_vectorstore, load_vectorstore
from retriver.create_retriever import create_retriever
from chains.build_chain import build_chain
from chains.memory import add_memory, get_session_history
from sqlalchemy import create_engine, text

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="YouTube RAG Bot API",
    description="AI-powered Q&A system for YouTube videos",
    version="1.0.0"
)

# CORS Configuration - CRITICAL FOR CHROME EXTENSION
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for active chains
active_chains = {}
chain_last_used = {}  # Track last access time for cleanup

# Database engine for session queries
engine = create_engine("sqlite:///chat_memory.db")

# ==================== REQUEST MODELS ====================

class ProcessVideoRequest(BaseModel):
    video_id: str = Field(..., min_length=11, max_length=11)
    
    @validator('video_id')
    def validate_video_id(cls, v):
        """Validate YouTube video ID format"""
        if not re.match(r'^[a-zA-Z0-9_-]{11}$', v):
            raise ValueError('Invalid YouTube video ID format')
        return v

class QuestionRequest(BaseModel):
    video_id: str = Field(..., min_length=11, max_length=11)
    question: str = Field(..., min_length=1, max_length=1000)
    session_id: Optional[str] = Field(default="default", max_length=50)
    
    @validator('video_id')
    def validate_video_id(cls, v):
        if not re.match(r'^[a-zA-Z0-9_-]{11}$', v):
            raise ValueError('Invalid YouTube video ID format')
        return v
    
    @validator('session_id')
    def validate_session_id(cls, v):
        """Ensure session_id is safe (alphanumeric, dash, underscore only)"""
        if not re.match(r'^[a-zA-Z0-9_-]+$', v):
            raise ValueError('Invalid session ID format')
        return v
    
    @validator('question')
    def validate_question(cls, v):
        """Basic validation of question content"""
        v = v.strip()
        if len(v) < 1:
            raise ValueError('Question cannot be empty')
        # Check for spam (repeated characters)
        if re.search(r'(.)\1{50,}', v):
            raise ValueError('Question contains suspicious content')
        return v

class ClearSessionRequest(BaseModel):
    video_id: str
    session_id: str = "default"

class ChatResponse(BaseModel):
    answer: str
    video_id: str
    session_id: str
    processing_time: Optional[float] = None

# ==================== HELPER FUNCTIONS ====================

def cleanup_old_chains(max_age_seconds: int = 3600):
    """Remove chains not used in last hour"""
    current_time = time.time()
    to_remove = []
    
    for video_id, last_used in chain_last_used.items():
        if current_time - last_used > max_age_seconds:
            to_remove.append(video_id)
    
    for video_id in to_remove:
        if video_id in active_chains:
            del active_chains[video_id]
            del chain_last_used[video_id]
            logger.info(f"Cleaned up inactive chain for video: {video_id}")
    
    return len(to_remove)

# ==================== API ENDPOINTS ====================

@app.get("/")
async def health_check():
    """Health check endpoint with system status"""
    return {
        "status": "ok",
        "service": "YouTube RAG API",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "active_videos": len(active_chains)
    }

@app.get("/health")
async def detailed_health():
    """Detailed health check with metrics"""
    try:
        # Test database connection
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"
    
    return {
        "status": "ok",
        "database": db_status,
        "active_chains": len(active_chains),
        "cached_videos": list(active_chains.keys()),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/process-video")
async def process_video(request: ProcessVideoRequest):
    """
    Process a YouTube video and prepare it for Q&A.
    
    - Fetches transcript
    - Creates embeddings
    - Builds RAG chain
    - Caches for fast subsequent queries
    """
    start_time = time.time()
    video_id = request.video_id
    
    try:
        logger.info(f"Processing video: {video_id}")
        
        # Check if already cached
        vectorstore = load_vectorstore(video_id)
        
        if vectorstore is None:
            logger.info(f"No cached vectorstore found for {video_id}, creating new one")
            
            # Fetch transcript
            try:
                transcript = youtube_transcripts(video_id)
            except Exception as e:
                error_msg = str(e).lower()
                
                if "disabled" in error_msg:
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "error": "Transcripts disabled",
                            "message": "This video has captions disabled by the creator",
                            "suggestion": "Try a video with captions enabled (usually educational content)"
                        }
                    )
                elif "not found" in error_msg:
                    raise HTTPException(
                        status_code=404,
                        detail={
                            "error": "Video not found",
                            "message": "Could not find this video or it has no transcript",
                            "suggestion": "Check the video ID and ensure the video exists"
                        }
                    )
                else:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "error": "Service unavailable",
                            "message": f"Could not fetch transcript: {str(e)}",
                            "suggestion": "Please try again in a moment"
                        }
                    )
            
            if not transcript or len(transcript.strip()) < 50:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "Insufficient content",
                        "message": "Video transcript is too short or empty",
                        "suggestion": "Try a longer video with more spoken content"
                    }
                )
            
            logger.info(f"Transcript fetched successfully: {len(transcript)} characters")
            
            # Split into chunks
            logger.info("Creating chunks...")
            docs = text_splitter(transcript)
            logger.info(f"Created {len(docs)} chunks")
            
            # Create and save vectorstore
            logger.info("Creating embeddings and vectorstore...")
            vectorstore = create_vectorstore(docs, video_id)
            logger.info(f"Vectorstore created and saved for {video_id}")
        else:
            logger.info(f"Loaded cached vectorstore for {video_id}")
        
        # Build RAG chain
        logger.info("Building RAG chain...")
        retriever = create_retriever(vectorstore)
        chain = build_chain(retriever)
        chain_with_memory = add_memory(chain)
        
        # Cache the chain
        active_chains[video_id] = chain_with_memory
        chain_last_used[video_id] = time.time()
        
        processing_time = time.time() - start_time
        logger.info(f"Video {video_id} processed successfully in {processing_time:.2f}s")
        
        return {
            "status": "success",
            "video_id": video_id,
            "message": "Video processed and ready for questions",
            "processing_time": round(processing_time, 2),
            "cached": vectorstore is not None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing video {video_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "message": "An unexpected error occurred while processing the video",
                "details": str(e)
            }
        )

@app.post("/ask", response_model=ChatResponse)
async def ask_question(request: QuestionRequest):
    """
    Ask a question about a processed video.
    
    - Requires video to be processed first
    - Maintains conversation history per session
    - Returns AI-generated answer based on video content
    """
    start_time = time.time()
    video_id = request.video_id
    question = request.question
    full_session_id = f"{video_id}_{request.session_id}"
    
    try:
        logger.info(f"Question for {video_id} (session: {request.session_id}): {question[:100]}...")
        
        # Check if chain exists in memory
        if video_id not in active_chains:
            logger.info(f"Chain not in memory for {video_id}, attempting to load")
            
            # Try to load vectorstore from disk
            vectorstore = load_vectorstore(video_id)
            
            if vectorstore is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "error": "Video not processed",
                        "message": "This video hasn't been processed yet",
                        "suggestion": "Call /process-video first with this video_id"
                    }
                )
            
            # Rebuild chain from cached vectorstore
            logger.info(f"Rebuilding chain from cached vectorstore for {video_id}")
            retriever = create_retriever(vectorstore)
            chain = build_chain(retriever)
            chain_with_memory = add_memory(chain)
            active_chains[video_id] = chain_with_memory
        
        # Update last used time
        chain_last_used[video_id] = time.time()
        
        # Invoke the chain with conversation history
        logger.info(f"Invoking chain for session {full_session_id}")
        answer = active_chains[video_id].invoke(
            {"question": question},
            config={"configurable": {"session_id": full_session_id}}
        )
        
        processing_time = time.time() - start_time
        logger.info(f"Answer generated in {processing_time:.2f}s")
        
        # Periodic cleanup (every 10th request)
        if len(active_chains) > 10 and time.time() % 10 < 1:
            cleaned = cleanup_old_chains()
            if cleaned > 0:
                logger.info(f"Cleaned up {cleaned} inactive chains")
        
        return ChatResponse(
            answer=answer,
            video_id=video_id,
            session_id=full_session_id,
            processing_time=round(processing_time, 2)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error answering question for {video_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "message": "An error occurred while processing your question",
                "details": str(e)
            }
        )

@app.delete("/session/{video_id}/{session_id}")
async def clear_session(video_id: str, session_id: str = "default"):
    """
    Clear conversation history for a specific session.
    
    - Deletes all messages from the session
    - Allows starting a fresh conversation
    - Does not affect the processed video or other sessions
    """
    try:
        full_session_id = f"{video_id}_{session_id}"
        logger.info(f"Clearing session: {full_session_id}")
        
        # Get and clear the session history
        history = get_session_history(full_session_id)
        message_count = len(history.messages)
        
        if message_count == 0:
            return {
                "status": "success",
                "message": "Session was already empty",
                "session_id": full_session_id,
                "messages_cleared": 0
            }
        
        history.clear()
        logger.info(f"Cleared {message_count} messages from session {full_session_id}")
        
        return {
            "status": "success",
            "message": "Session cleared successfully",
            "session_id": full_session_id,
            "messages_cleared": message_count
        }
        
    except Exception as e:
        logger.error(f"Error clearing session {video_id}_{session_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "message": "Could not clear session",
                "details": str(e)
            }
        )

@app.get("/sessions/{video_id}")
async def list_sessions(video_id: str):
    """
    List all conversation sessions for a video.
    
    - Shows all active sessions
    - Includes message count and last update time
    - Useful for managing multiple conversations
    """
    try:
        logger.info(f"Listing sessions for video: {video_id}")
        
        with engine.connect() as conn:
            # Query unique session IDs for this video
            result = conn.execute(text("""
                SELECT DISTINCT session_id, 
                       COUNT(*) as message_count,
                       MAX(created_at) as last_updated
                FROM message_store
                WHERE session_id LIKE :pattern
                GROUP BY session_id
                ORDER BY last_updated DESC
            """), {"pattern": f"{video_id}_%"})
            
            sessions = []
            for row in result:
                sessions.append({
                    "session_id": row[0],
                    "message_count": row[1],
                    "last_updated": str(row[2]) if row[2] else None
                })
        
        return {
            "video_id": video_id,
            "session_count": len(sessions),
            "sessions": sessions
        }
        
    except Exception as e:
        logger.error(f"Error listing sessions for {video_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "message": "Could not retrieve sessions",
                "details": str(e)
            }
        )

@app.get("/history/{video_id}/{session_id}")
async def get_conversation_history(video_id: str, session_id: str = "default"):
    """
    Retrieve full conversation history for a session.
    
    - Returns all messages in chronological order
    - Useful for exporting or reviewing conversations
    """
    try:
        full_session_id = f"{video_id}_{session_id}"
        logger.info(f"Fetching history for session: {full_session_id}")
        
        history = get_session_history(full_session_id)
        messages = []
        
        for msg in history.messages:
            # Skip system messages (summaries)
            if msg.type == "system":
                messages.append({
                    "role": "system",
                    "content": msg.content,
                    "type": "summary"
                })
            else:
                messages.append({
                    "role": "user" if msg.type == "human" else "assistant",
                    "content": msg.content,
                    "type": "message"
                })
        
        return {
            "session_id": full_session_id,
            "video_id": video_id,
            "message_count": len(messages),
            "messages": messages
        }
        
    except Exception as e:
        logger.error(f"Error fetching history for {video_id}_{session_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "message": "Could not retrieve conversation history",
                "details": str(e)
            }
        )

@app.post("/cleanup")
async def manual_cleanup(max_age_hours: int = 1):
    """
    Manually trigger cleanup of inactive chains.
    
    - Removes chains not used in the specified time period
    - Frees up memory
    - Admin/maintenance endpoint
    """
    try:
        max_age_seconds = max_age_hours * 3600
        cleaned = cleanup_old_chains(max_age_seconds)
        
        return {
            "status": "success",
            "chains_removed": cleaned,
            "remaining_chains": len(active_chains),
            "max_age_hours": max_age_hours
        }
        
    except Exception as e:
        logger.error(f"Error during cleanup: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Cleanup failed",
                "details": str(e)
            }
        )

# ==================== STARTUP/SHUTDOWN EVENTS ====================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("=" * 50)
    logger.info("YouTube RAG API Starting...")
    logger.info("=" * 50)
    logger.info(f"Database: chat_memory.db")
    logger.info(f"Vectorstore cache: ./vectorstores/")
    logger.info("Server ready to accept requests")
    logger.info("=" * 50)

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down YouTube RAG API...")
    active_chains.clear()
    chain_last_used.clear()
    logger.info("Shutdown complete")

