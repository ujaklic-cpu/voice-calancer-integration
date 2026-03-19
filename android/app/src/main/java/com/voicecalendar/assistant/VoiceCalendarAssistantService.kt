package com.voicecalendar.assistant

import android.content.Intent
import android.service.voice.VoiceInteractionService

class VoiceCalendarAssistantService : VoiceInteractionService() {
    override fun onLaunchVoiceAssistFromKeyguard() {
        super.onLaunchVoiceAssistFromKeyguard()
        startAssistantActivity()
    }

    override fun onReady() {
        super.onReady()
        startAssistantActivity()
    }

    private fun startAssistantActivity() {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
    }
}
