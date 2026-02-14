from langchain_community.vectorstores import FAISS
from embedding.local_embedding import create_embedding
from langchain_core.documents import Document
import os
def create_vectorstore(docs:list[Document],video_id:str=None):
    embeddings = create_embedding()
    vectorstore=FAISS.from_documents(docs, embeddings)
    if video_id:
        save_path = f"./vectorstores/{video_id}"
        os.makedirs("./vectorstores", exist_ok=True)
        vectorstore.save_local(save_path)
    
    return vectorstore
def load_vectorstore(video_id:str):
    save_path = f"./vectorstores/{video_id}"
    
    if os.path.exists(save_path):
        embeddings = create_embedding()
        return FAISS.load_local(save_path, embeddings, allow_dangerous_deserialization=True)
    
    return None