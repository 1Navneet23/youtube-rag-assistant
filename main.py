from transcripts.fetch_transcript import youtube_transcripts
from processing.split_text import text_splitter
from vectorstore.create_vectorstore import create_vectorstore,load_vectorstore
from retriver.create_retriever import create_retriever
from chains.build_chain import build_chain
from chains.memory import add_memory


def main():
    video_id = "7ARBJQn6QkM"

     
    # main.py - Logic update
    vectorstore = load_vectorstore(video_id)
    if not vectorstore:
        transcript = youtube_transcripts(video_id)
        docs = text_splitter(transcript)
        vectorstore = create_vectorstore(docs, video_id=video_id)
    retriever = create_retriever(vectorstore)

    rag_chain = build_chain(retriever)
    rag_with_memory = add_memory(rag_chain)

    session_id = "session-1"

    while True:
        question = input("\nAsk a question (or exit): ")
        if question.lower() == "exit":
            break

        answer = rag_with_memory.invoke(
            {"question": question},
            config={"configurable": {"session_id": session_id}},
        )

        print("\nAnswer:\n", answer)


if __name__ == "__main__":
    main()
