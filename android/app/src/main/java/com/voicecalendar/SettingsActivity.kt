package com.voicecalendar

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("voice_calendar", MODE_PRIVATE)

        // Build layout programmatically — keeps the activity self-contained
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            setBackgroundColor(0xFF1C1C1C.toInt())
        }

        val tvTitle = android.widget.TextView(this).apply {
            text = "Settings"
            textSize = 18f
            setTextColor(0xFFE8E8E8.toInt())
            setPadding(0, 0, 0, 32)
        }

        val tvLabel = android.widget.TextView(this).apply {
            text = "Server URL"
            textSize = 12f
            setTextColor(0xFF999999.toInt())
            setPadding(0, 0, 0, 8)
        }

        val etUrl = EditText(this).apply {
            setText(prefs.getString("server_url", ""))
            hint = "https://your-server.example.com"
            setHintTextColor(0xFF666666.toInt())
            setTextColor(0xFFE8E8E8.toInt())
            setBackgroundColor(0xFF323232.toInt())
            setPadding(24, 20, 24, 20)
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI or android.text.InputType.TYPE_CLASS_TEXT
        }

        val btnSave = Button(this).apply {
            text = "Save"
            backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF0078D7.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            stateListAnimator = null
            setPadding(0, 16, 0, 16)
        }

        btnSave.setOnClickListener {
            val url = etUrl.text.toString().trim().trimEnd('/')
            prefs.edit().putString("server_url", url).apply()
            finish()
        }

        val lp = android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = 24 }

        layout.addView(tvTitle)
        layout.addView(tvLabel)
        layout.addView(etUrl, lp)
        layout.addView(btnSave)

        setContentView(layout)
        supportActionBar?.title = "Settings"
    }
}
