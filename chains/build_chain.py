from langchain_groq import ChatGroq
from langchain_core.runnables import (
    RunnableParallel,
    RunnableLambda,
    RunnablePassthrough
)
from langchain_core.output_parsers import StrOutputParser
from dotenv import load_dotenv
load_dotenv()

from prompt.prompt_template import create_prompt
from utils.format import format_docs

def build_chain(retriever):

    llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0
  )


    chain = (
    RunnableParallel(
        {
            "context": RunnableLambda(lambda x: x["question"]) 
                        | retriever 
                        | RunnableLambda(format_docs),

            "question": RunnableLambda(lambda x: x["question"]),

            "history": RunnableLambda(lambda x: x.get("history", ""))
        }
    )
    | create_prompt()
    | llm
    | StrOutputParser()
    )


    return chain
