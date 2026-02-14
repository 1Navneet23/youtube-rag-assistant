from langchain_experimental.text_splitter import SemanticChunker 
from embedding.local_embedding import create_embedding
def text_splitter(text:str):
    '''splitter=RecursiveCharacterTextSplitter(chunk_size=1000,
        chunk_overlap=200,  # Increased from 20 for better continuity
        separators=["\n\n", "\n", ".", "!", "?", ",", " ", ""],
        length_function=len)
    return splitter.create_documents([text])'''
    embedding=create_embedding()
    chunker=SemanticChunker(embedding,breakpoint_threshold_type="standard_deviation",breakpoint_threshold_amount=1)
    return chunker.create_documents([text])
