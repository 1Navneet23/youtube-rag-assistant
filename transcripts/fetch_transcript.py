from youtube_transcript_api import YouTubeTranscriptApi , TranscriptsDisabled ,NoTranscriptFound
def youtube_transcripts(video_id:str)->str:
    try:
        youtube=YouTubeTranscriptApi().fetch(video_id)
        return ''.join(entry.text for entry in youtube)
    except TranscriptsDisabled :
        raise Exception("transcript are disabled for the video")
    except NoTranscriptFound:
        raise Exception(f"No transcript found for video: {video_id}")
    except Exception as e:
        raise Exception(f"Error fetching transcript: {str(e)}")