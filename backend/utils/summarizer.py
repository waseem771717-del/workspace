import sys
import json
import re
from youtube_transcript_api import YouTubeTranscriptApi
from transformers import pipeline

def extract_video_id(url):
    patterns = [
        r'(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})',
        r'(?:youtu\.be\/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def fetch_transcript(video_id):
    try:
        # In this version, we need an instance of YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)
        
        # Try to get English manually created transcript
        try:
            transcript = transcript_list.find_manually_created_transcript(['en'])
        except:
            # Fallback to English auto-generated transcript
            try:
                transcript = transcript_list.find_generated_transcript(['en'])
            except:
                # Fallback to any available transcript
                transcript = transcript_list.find_transcript(['en'])
        
        data = transcript.fetch()
        texts = []
        for entry in data:
            if isinstance(entry, dict):
                texts.append(entry['text'])
            else:
                # Handle FetchedTranscriptSnippet or other objects
                texts.append(getattr(entry, 'text', str(entry)))
        
        return " ".join(texts)
    except Exception as e:
        print(f"Transcript Fetch Error: {e}", file=sys.stderr)
        return None

def chunk_text(text, chunk_size=1000):
    # Split by sentences if possible to avoid breaking words
    sentences = re.split(r'(?<=[.!?]) +', text)
    chunks = []
    current_chunk = ""
    for sentence in sentences:
        if len(current_chunk) + len(sentence) <= chunk_size:
            current_chunk += sentence + " "
        else:
            chunks.append(current_chunk.strip())
            current_chunk = sentence + " "
    if current_chunk:
        chunks.append(current_chunk.strip())
    return chunks

def summarize_video(url, request_type=None):
    video_id = extract_video_id(url)
    if not video_id:
        return {"error": "Invalid YouTube URL"}

    transcript = fetch_transcript(video_id)
    if not transcript:
        return {"error": "This video does not have available captions, so it cannot be summarized using transcript extraction."}

    # Initialize summarizer
    # Note: On first run, this downloads ~1.6GB
    summarizer = pipeline("summarization", model="facebook/bart-large-cnn")

    chunks = chunk_text(transcript, chunk_size=1000)
    chunk_summaries = []

    for chunk in chunks:
        if len(chunk) < 100: # Skip very short chunks
            continue
        summary = summarizer(chunk, max_length=150, min_length=40, do_sample=False)
        chunk_summaries.append(summary[0]['summary_text'])

    combined_summary = " ".join(chunk_summaries)

    # If the text is still long, we might need a meta-summary, 
    # but for BART large CNN, we can try one more pass if it's manageable
    # or just use the combined chunk summaries as the source for extraction.
    
    final_summary_text = combined_summary

    # Extract sections for the structured output
    # Since BART is just a summarizer, we use it to generate the "Short Summary" first
    if len(final_summary_text) > 1000:
        short_summary_input = final_summary_text[:1000] # Take first 1000 of combined summaries
        short_summary_res = summarizer(short_summary_input, max_length=100, min_length=40, do_sample=False)
        short_summary = short_summary_res[0]['summary_text']
    else:
        short_summary = final_summary_text

    # For "Detailed Summary" / "Key Points", we can treat the chunk summaries as bullet points 
    # or process them to be more cleanly formatted.
    detailed_points = chunk_summaries[:10] # Limit to 10 points for sanity

    output = {
        "title": f"Video {video_id}", # We don't have easy access to title here without more libs, but Node can pass it
        "short_summary": short_summary,
        "detailed_summary": "\n".join([f"- {s.strip()}" for s in detailed_points]),
        "key_takeaways": detailed_points[:5],
        "full_text": final_summary_text
    }

    # Filtering based on request_type if provided
    if request_type == "short summary":
        return {"short_summary": output["short_summary"]}
    elif request_type == "detailed summary":
        return {"detailed_summary": output["detailed_summary"]}
    elif request_type == "key points":
        return {"key_points": output["detailed_summary"]}

    return output

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)

    url = sys.argv[1]
    req_type = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        result = summarize_video(url, req_type)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
