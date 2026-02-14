from langchain_core.prompts import PromptTemplate

def create_prompt():
    return PromptTemplate(
        template= """You are an AI assistant helping users understand YouTube video content.

**Context from Video Transcript:**
{context}

**Previous Conversation:**
{history}

**User Question:** {question}

**Instructions:**
- Answer based ONLY on the video transcript provided in the context
- If the answer is not in the transcript, clearly state "This information is not covered in the video"
- Be concise and direct
- Quote relevant parts from the transcript when helpful
- Use natural language and be conversational
- Answer in English even if context is another language

**Answer:**""",
        input_variables=["context", "question", "history"],
    )
