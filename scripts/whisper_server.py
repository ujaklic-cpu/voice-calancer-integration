"""
scripts/whisper_server.py
Minimal Flask REST wrapper for OpenAI Whisper.
Used by Dockerfile.whisper.
"""
import io
import whisper
from flask import Flask, request, jsonify

app = Flask(__name__)
model = whisper.load_model("base")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    audio_bytes = request.get_data()
    if not audio_bytes:
        return jsonify({"error": "no audio data"}), 400
    # Write to a temp file that whisper can read
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        result = model.transcribe(tmp_path)
    finally:
        os.unlink(tmp_path)
    return jsonify({
        "text": result.get("text", "").strip(),
        "language": result.get("language", ""),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9001)
