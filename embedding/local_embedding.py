from langchain_community.embeddings import HuggingFaceBgeEmbeddings
 
_embedding_instance = None

def create_embedding():
    global _embedding_instance
    if _embedding_instance is None:
        _embedding_instance = HuggingFaceBgeEmbeddings(
            model_name="intfloat/multilingual-e5-base",
            encode_kwargs={'normalize_embeddings': True}
        )
    return _embedding_instance