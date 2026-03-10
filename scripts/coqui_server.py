"""
scripts/coqui_server.py
Minimal Flask REST wrapper for Coqui TTS.
Used by Dockerfile.coqui.
"""
import io
from TTS.api import TTS
from flask import Flask, request, send_file, jsonify

app = Flask(__name__)
tts = TTS("tts_models/en/ljspeech/tacotron2-DDC")


@app.route("/synthesize", methods=["POST"])
def synthesize():
    data = request.get_json(force=True) or {}
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "missing text"}), 400
    buf = io.BytesIO()
    tts.tts_to_file(text=text, file_path=buf)
    buf.seek(0)
    return send_file(buf, mimetype="audio/wav")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)
