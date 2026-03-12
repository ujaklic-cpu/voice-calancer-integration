package com.voicecalendar

import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private lateinit var prefs: SharedPreferences
    private lateinit var tts: TextToSpeech
    private var ttsReady = false
    private var parsedEvent: JSONObject? = null
    private var createdEventTitle: String? = null
    private var inputMode = "voice"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    // Views
    private lateinit var btnSignOut: Button
    private lateinit var btnSettings: Button
    private lateinit var etGoogleUserId: EditText
    private lateinit var btnAuthorize: Button
    private lateinit var tvAuthStatus: TextView
    private lateinit var btnModeVoice: Button
    private lateinit var btnModeType: Button
    private lateinit var panelVoice: LinearLayout
    private lateinit var panelText: LinearLayout
    private lateinit var btnRecord: Button
    private lateinit var tvRecStatus: TextView
    private lateinit var btnTranscribe: Button
    private lateinit var tvSttStatus: TextView
    private lateinit var etDirectInput: EditText
    private lateinit var etTranscript: EditText
    private lateinit var btnParse: Button
    private lateinit var tvAiStatus: TextView
    private lateinit var tvParsedResult: TextView
    private lateinit var btnCreate: Button
    private lateinit var tvCalStatus: TextView
    private lateinit var btnSpeak: Button
    private lateinit var tvTtsStatus: TextView

    // Speech recognizer (on-device)
    private var speechRecognizer: SpeechRecognizer? = null
    private var isRecording = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        supportActionBar?.title = "Voice Calendar"

        prefs = getSharedPreferences("voice_calendar", MODE_PRIVATE)
        tts = TextToSpeech(this, this)

        bindViews()
        setupListeners()
    }

    private fun bindViews() {
        btnSignOut     = findViewById(R.id.btnSignOut)
        btnSettings    = findViewById(R.id.btnSettings)
        etGoogleUserId = findViewById(R.id.etGoogleUserId)
        btnAuthorize   = findViewById(R.id.btnAuthorize)
        tvAuthStatus   = findViewById(R.id.tvAuthStatus)
        btnModeVoice   = findViewById(R.id.btnModeVoice)
        btnModeType    = findViewById(R.id.btnModeType)
        panelVoice     = findViewById(R.id.panelVoice)
        panelText      = findViewById(R.id.panelText)
        btnRecord      = findViewById(R.id.btnRecord)
        tvRecStatus    = findViewById(R.id.tvRecStatus)
        btnTranscribe  = findViewById(R.id.btnTranscribe)
        tvSttStatus    = findViewById(R.id.tvSttStatus)
        etDirectInput  = findViewById(R.id.etDirectInput)
        etTranscript   = findViewById(R.id.etTranscript)
        btnParse       = findViewById(R.id.btnParse)
        tvAiStatus     = findViewById(R.id.tvAiStatus)
        tvParsedResult = findViewById(R.id.tvParsedResult)
        btnCreate      = findViewById(R.id.btnCreate)
        tvCalStatus    = findViewById(R.id.tvCalStatus)
        btnSpeak       = findViewById(R.id.btnSpeak)
        tvTtsStatus    = findViewById(R.id.tvTtsStatus)
    }

    private fun setupListeners() {
        btnSignOut.setOnClickListener { signOut() }
        btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        btnAuthorize.setOnClickListener { authorizeGoogle() }
        btnModeVoice.setOnClickListener { setMode("voice") }
        btnModeType.setOnClickListener  { setMode("text") }
        btnRecord.setOnClickListener    { toggleRecord() }
        btnTranscribe.setOnClickListener { runStt() }
        btnParse.setOnClickListener     { runAi() }
        btnCreate.setOnClickListener    { createEvent() }
        btnSpeak.setOnClickListener     { speakConfirmation() }

        etDirectInput.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                etTranscript.setText(s?.toString() ?: "")
                btnParse.isEnabled = !s.isNullOrBlank()
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })
    }

    private fun setMode(mode: String) {
        inputMode = mode
        btnModeVoice.backgroundTintList = getColorStateList(
            if (mode == "voice") R.color.accent else R.color.surface2
        )
        btnModeVoice.setTextColor(
            if (mode == "voice") getColor(android.R.color.white) else getColor(R.color.text_dim)
        )
        btnModeType.backgroundTintList = getColorStateList(
            if (mode == "text") R.color.accent else R.color.surface2
        )
        btnModeType.setTextColor(
            if (mode == "text") getColor(android.R.color.white) else getColor(R.color.text_dim)
        )
        panelVoice.visibility = if (mode == "voice") View.VISIBLE else View.GONE
        panelText.visibility  = if (mode == "text")  View.VISIBLE else View.GONE
        if (mode == "text") btnParse.isEnabled = etDirectInput.text.isNotBlank()
    }

    private fun authorizeGoogle() {
        val userId = etGoogleUserId.text.toString().trim()
        if (userId.isEmpty()) {
            tvAuthStatus.text = "Enter a Google user ID first."
            tvAuthStatus.setTextColor(getColor(R.color.error))
            return
        }
        val serverUrl = prefs.getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) {
            tvAuthStatus.text = "Configure server URL in Settings."
            tvAuthStatus.setTextColor(getColor(R.color.error))
            return
        }
        val cookie = prefs.getString("session_cookie", "") ?: ""
        val url = "$serverUrl/auth/url?userId=${Uri.encode(userId)}"
        // Open in browser (the OAuth flow happens in a browser)
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        })
        tvAuthStatus.text = "Complete OAuth in the browser, then return here."
        tvAuthStatus.setTextColor(getColor(R.color.text_ok))
        // Suppress unused warning
        cookie.length
    }

    // ---------------------------------------------------------------------------
    // Voice recording (on-device SpeechRecognizer — no Whisper needed)
    // ---------------------------------------------------------------------------
    private fun toggleRecord() {
        if (isRecording) {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private fun startRecording() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            tvRecStatus.text = "On-device speech recognition not available."
            tvRecStatus.setTextColor(getColor(R.color.error))
            return
        }
        isRecording = true
        btnRecord.text = "Stop Recording"
        btnRecord.backgroundTintList = getColorStateList(R.color.danger)
        tvRecStatus.text = "Listening…"
        tvRecStatus.setTextColor(getColor(R.color.text_dim))

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }

        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                tvRecStatus.text = "Listening…"
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {
                tvRecStatus.text = "Processing…"
            }
            override fun onError(error: Int) {
                isRecording = false
                btnRecord.text = "Start Recording"
                btnRecord.backgroundTintList = getColorStateList(R.color.accent)
                tvRecStatus.text = "Recognition error ($error). Try again."
                tvRecStatus.setTextColor(getColor(R.color.error))
            }
            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull() ?: ""
                etTranscript.setText(text)
                btnParse.isEnabled = text.isNotBlank()
                isRecording = false
                btnRecord.text = "Start Recording"
                btnRecord.backgroundTintList = getColorStateList(R.color.accent)
                tvRecStatus.text = "Done."
                tvRecStatus.setTextColor(getColor(R.color.text_ok))
                btnTranscribe.isEnabled = false
                tvSttStatus.text = "On-device transcription complete."
            }
            override fun onPartialResults(partial: Bundle?) {
                val matches = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                etTranscript.setText(matches?.firstOrNull() ?: "")
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        speechRecognizer?.startListening(intent)
    }

    private fun stopRecording() {
        speechRecognizer?.stopListening()
        isRecording = false
        btnRecord.text = "Start Recording"
        btnRecord.backgroundTintList = getColorStateList(R.color.accent)
    }

    // ---------------------------------------------------------------------------
    // Server-side STT via Whisper (optional fallback)
    // ---------------------------------------------------------------------------
    private fun runStt() {
        tvSttStatus.text = "On-device STT is preferred. Use the Record button above."
        tvSttStatus.setTextColor(getColor(R.color.text_dim))
    }

    // ---------------------------------------------------------------------------
    // AI parsing
    // ---------------------------------------------------------------------------
    private fun runAi() {
        val text = etTranscript.text.toString().trim()
        if (text.isEmpty()) {
            tvAiStatus.text = "Enter text first."
            tvAiStatus.setTextColor(getColor(R.color.error))
            return
        }

        tvAiStatus.text = "Parsing…"
        tvAiStatus.setTextColor(getColor(R.color.text_dim))
        btnParse.isEnabled = false

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { callApi("POST", "/api/ai", """{"text":${JSONObject.quote(text)}}""") }
            btnParse.isEnabled = true
            if (result.first) {
                val json = try { JSONObject(result.second) } catch (e: Exception) { null }
                if (json != null) {
                    parsedEvent = json
                    tvParsedResult.text = result.second
                    tvParsedResult.visibility = View.VISIBLE
                    btnCreate.isEnabled = true
                    tvAiStatus.text = "Parsed."
                    tvAiStatus.setTextColor(getColor(R.color.text_ok))
                } else {
                    tvAiStatus.text = "Bad response: ${result.second.take(100)}"
                    tvAiStatus.setTextColor(getColor(R.color.error))
                }
            } else {
                tvAiStatus.text = "Error: ${result.second.take(200)}"
                tvAiStatus.setTextColor(getColor(R.color.error))
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Create calendar event
    // ---------------------------------------------------------------------------
    private fun createEvent() {
        val event = parsedEvent ?: return
        val userId = etGoogleUserId.text.toString().trim()
        if (userId.isEmpty()) {
            tvCalStatus.text = "Enter your Google user ID first."
            tvCalStatus.setTextColor(getColor(R.color.error))
            return
        }

        event.put("userId", userId)

        tvCalStatus.text = "Creating event…"
        tvCalStatus.setTextColor(getColor(R.color.text_dim))
        btnCreate.isEnabled = false

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { callApi("POST", "/api/calendar", event.toString()) }
            if (result.first) {
                val json = try { JSONObject(result.second) } catch (e: Exception) { null }
                createdEventTitle = try {
                    json?.optJSONObject("created")?.optString("summary")
                        ?: parsedEvent?.optString("title")
                        ?: "your event"
                } catch (e: Exception) { "your event" }
                tvCalStatus.text = "Event created."
                tvCalStatus.setTextColor(getColor(R.color.text_ok))
                btnSpeak.isEnabled = true
            } else {
                tvCalStatus.text = "Error: ${result.second.take(200)}"
                tvCalStatus.setTextColor(getColor(R.color.error))
                btnCreate.isEnabled = true
            }
        }
    }

    // ---------------------------------------------------------------------------
    // TTS confirmation (on-device Android TTS)
    // ---------------------------------------------------------------------------
    private fun speakConfirmation() {
        val title = createdEventTitle ?: "your event"
        val text = "Your event \"$title\" has been added to Google Calendar."
        tvTtsStatus.text = "Speaking…"
        tvTtsStatus.setTextColor(getColor(R.color.text_dim))
        if (ttsReady) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "confirm")
            tvTtsStatus.text = "Done."
            tvTtsStatus.setTextColor(getColor(R.color.text_ok))
        } else {
            tvTtsStatus.text = "TTS not ready yet."
            tvTtsStatus.setTextColor(getColor(R.color.error))
        }
    }

    // ---------------------------------------------------------------------------
    // HTTP helper
    // ---------------------------------------------------------------------------
    private fun callApi(method: String, path: String, body: String): Pair<Boolean, String> {
        val serverUrl = prefs.getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) return Pair(false, "Server URL not configured.")
        val cookie = prefs.getString("session_cookie", "") ?: ""
        return try {
            val reqBody = body.toRequestBody("application/json".toMediaType())
            val builder = Request.Builder()
                .url("${serverUrl.trimEnd('/')}$path")
                .header("Content-Type", "application/json")
            if (cookie.isNotEmpty()) builder.header("Cookie", cookie)
            val request = when (method) {
                "POST" -> builder.post(reqBody).build()
                else   -> builder.get().build()
            }
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""
            Pair(response.isSuccessful, responseBody)
        } catch (e: Exception) {
            Pair(false, e.message ?: "Unknown error")
        }
    }

    // ---------------------------------------------------------------------------
    // Sign out
    // ---------------------------------------------------------------------------
    private fun signOut() {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val serverUrl = prefs.getString("server_url", "") ?: ""
                    val cookie = prefs.getString("session_cookie", "") ?: ""
                    if (serverUrl.isNotEmpty()) {
                        val request = Request.Builder()
                            .url("${serverUrl.trimEnd('/')}/auth/logout")
                            .header("Cookie", cookie)
                            .post("{}".toRequestBody("application/json".toMediaType()))
                            .build()
                        client.newCall(request).execute()
                    }
                } catch (_: Exception) {}
            }
            prefs.edit().remove("session_cookie").apply()
            startActivity(Intent(this@MainActivity, LoginActivity::class.java))
            finish()
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts.language = Locale.getDefault()
            ttsReady = true
        }
    }

    override fun onDestroy() {
        speechRecognizer?.destroy()
        tts.shutdown()
        super.onDestroy()
    }
}
