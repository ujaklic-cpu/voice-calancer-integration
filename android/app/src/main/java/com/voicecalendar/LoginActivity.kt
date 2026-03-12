package com.voicecalendar

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
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
import java.util.concurrent.TimeUnit

class LoginActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var etUsername: EditText
    private lateinit var etPassword: EditText
    private lateinit var tvError: TextView
    private lateinit var btnLogin: Button
    private lateinit var prefs: SharedPreferences

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        supportActionBar?.hide()

        prefs = getSharedPreferences("voice_calendar", MODE_PRIVATE)

        etServerUrl = findViewById(R.id.etServerUrl)
        etUsername = findViewById(R.id.etUsername)
        etPassword = findViewById(R.id.etPassword)
        tvError = findViewById(R.id.tvLoginError)
        btnLogin = findViewById(R.id.btnLogin)

        // Restore saved server URL
        etServerUrl.setText(prefs.getString("server_url", ""))

        // If already have a session, try to go straight to main
        val savedCookie = prefs.getString("session_cookie", null)
        val savedUrl = prefs.getString("server_url", null)
        if (!savedCookie.isNullOrEmpty() && !savedUrl.isNullOrEmpty()) {
            checkExistingSession(savedUrl, savedCookie)
        }

        btnLogin.setOnClickListener { doLogin() }
        etPassword.setOnEditorActionListener { _, _, _ -> doLogin(); true }
    }

    private fun checkExistingSession(serverUrl: String, cookie: String) {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val request = Request.Builder()
                        .url("${serverUrl.trimEnd('/')}/auth/status")
                        .header("Cookie", cookie)
                        .get()
                        .build()
                    val response = client.newCall(request).execute()
                    if (response.isSuccessful) {
                        val body = response.body?.string() ?: return@withContext false
                        val json = JSONObject(body)
                        json.optBoolean("authenticated", false)
                    } else {
                        false
                    }
                } catch (e: Exception) {
                    false
                }
            }
            if (result) {
                goToMain()
            }
        }
    }

    private fun doLogin() {
        val serverUrl = etServerUrl.text.toString().trim().trimEnd('/')
        val username = etUsername.text.toString().trim()
        val password = etPassword.text.toString()

        tvError.visibility = View.GONE

        if (serverUrl.isEmpty()) {
            showError("Server URL is required.")
            return
        }
        if (username.isEmpty() || password.isEmpty()) {
            showError("Username and password are required.")
            return
        }

        btnLogin.isEnabled = false

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val json = JSONObject().apply {
                        put("username", username)
                        put("password", password)
                    }
                    val body = json.toString()
                        .toRequestBody("application/json".toMediaType())
                    val request = Request.Builder()
                        .url("$serverUrl/auth/login")
                        .post(body)
                        .build()
                    val response = client.newCall(request).execute()
                    // Extract Set-Cookie header
                    val setCookie = response.header("Set-Cookie")
                    val responseBody = response.body?.string() ?: ""
                    Triple(response.isSuccessful, setCookie, responseBody)
                } catch (e: Exception) {
                    Triple(false, null as String?, "Network error: ${e.message}")
                }
            }

            btnLogin.isEnabled = true
            val (success, cookie, errorBody) = result
            if (success) {
                // Persist server URL and session cookie
                prefs.edit()
                    .putString("server_url", serverUrl)
                    .putString("session_cookie", cookie ?: "")
                    .apply()
                goToMain()
            } else {
                try {
                    val errJson = JSONObject(errorBody)
                    showError(errJson.optString("error", "Login failed."))
                } catch (e: Exception) {
                    showError(errorBody.take(200).ifEmpty { "Login failed." })
                }
            }
        }
    }

    private fun showError(msg: String) {
        tvError.text = msg
        tvError.visibility = View.VISIBLE
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
