from langchain_core.runnables import RunnableWithMessageHistory
from langchain_community.chat_message_histories import SQLChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from sqlalchemy import create_engine
from langchain_groq import ChatGroq

# Database
engine = create_engine("sqlite:///chat_memory.db")

# LLM used only for summarization
summary_llm = ChatGroq(model="llama-3.1-8b-instant", temperature=0)

WINDOW = 6
THRESHOLD = 12


def summarize_incremental(old_summary, messages):
    """Update summary instead of recomputing everything"""

    conversation_text = "\n".join([
        f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
        for m in messages
    ])

    prompt = f"""You are updating a conversation summary.

PREVIOUS SUMMARY:
{old_summary or "None yet"}

NEW CONVERSATION TO ADD:
{conversation_text}

CRITICAL RULES:
1. Preserve ALL technical terms and specific concepts mentioned
2. Keep the summary concise (2-3 sentences max)
3. Focus on main topics discussed, not conversational filler
4. Never add information not present in the conversation
5. If previous summary is empty, just summarize new conversation

UPDATED SUMMARY:"""

    response = summary_llm.invoke(prompt)
    return f"[Earlier conversation summary: {response.content}]"


def get_session_history(session_id: str):

    history = SQLChatMessageHistory(
        session_id=session_id,
        connection=engine
    )

    messages = history.messages

    # Detect cached summary
    cached_summary = None
    if messages and isinstance(messages[0], SystemMessage):
        cached_summary = messages[0].content
        messages = messages[1:]

    # If too long → update summary
    if len(messages) > THRESHOLD:

        older = messages[:-WINDOW]
        recent = messages[-WINDOW:]

        new_summary = summarize_incremental(cached_summary or "", older)

        # Rewrite DB with summary + recent
        history.clear()
        history.add_message(SystemMessage(content=new_summary))

        for msg in recent:
            history.add_message(msg)

        return history

    return history


def add_memory(chain):
    return RunnableWithMessageHistory(
        chain,
        get_session_history,
        input_messages_key="question",
        history_messages_key="history",
    )
