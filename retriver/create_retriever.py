def create_retriever(vectorstore, question_type="general"):
    lambda_val = 0.4 if question_type == "general" else 0.7
    return vectorstore.as_retriever(
        search_type="mmr",
        search_kwargs={"k": 5, 'lambda_mult': lambda_val}
    )