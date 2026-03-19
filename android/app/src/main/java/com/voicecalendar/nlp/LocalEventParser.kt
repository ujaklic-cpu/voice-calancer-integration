package com.voicecalendar.nlp

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

object LocalEventParser {
    private val formatter: DateTimeFormatter = DateTimeFormatter.ISO_OFFSET_DATE_TIME

    fun parse(text: String, lang: String): JSONObject? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        val normalizedLang = lang.lowercase(Locale.ROOT)
        return when {
            normalizedLang.startsWith("sl") -> parseSlovenian(trimmed)
            normalizedLang.startsWith("en") -> parseEnglish(trimmed, normalizedLang)
            else -> parseSlovenian(trimmed) ?: parseEnglish(trimmed, "en-us")
        }
    }

    private fun parseSlovenian(text: String): JSONObject? {
        val pattern = Regex("sestanek z\\s+(.+?)\\s+jutri\\s+ob\\s+(devetih|\\d{1,2}(?::\\d{2})?)\\s+v\\s+(.+)", RegexOption.IGNORE_CASE)
        val match = pattern.find(text) ?: return null
        val person = match.groupValues[1].trim()
        val timeToken = match.groupValues[2].lowercase(Locale.ROOT)
        val location = match.groupValues[3].trim().trimEnd('.', ',', '!', ';', ':')

        val (hour, minute) = when (timeToken) {
            "devetih" -> 9 to 0
            else -> {
                val split = timeToken.split(":")
                val h = split[0].toIntOrNull() ?: return null
                val m = split.getOrNull(1)?.toIntOrNull() ?: 0
                h to m
            }
        }
        if (hour !in 0..23 || minute !in 0..59) return null
        return buildEvent(
            title = "Sestanek z $person",
            location = location,
            language = "sl-SI",
            rawText = text,
            hour = hour,
            minute = minute
        )
    }

    private fun parseEnglish(text: String, languageTag: String): JSONObject? {
        val pattern = Regex("meeting with\\s+(.+?)\\s+tomorrow\\s+at\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?(?:\\s+in\\s+(.+))?", RegexOption.IGNORE_CASE)
        val match = pattern.find(text) ?: return null
        val person = match.groupValues[1].trim()
        var hour = match.groupValues[2].toIntOrNull() ?: return null
        val minute = match.groupValues[3].toIntOrNull() ?: 0
        val ampm = match.groupValues[4].lowercase(Locale.ROOT)
        val location = match.groupValues.getOrElse(5) { "" }.trim().trimEnd('.', ',', '!', ';', ':')

        if (ampm == "pm" && hour < 12) hour += 12
        if (ampm == "am" && hour == 12) hour = 0
        if (hour !in 0..23 || minute !in 0..59) return null

        return buildEvent(
            title = "Meeting with $person",
            location = location.ifEmpty { null },
            language = if (languageTag.startsWith("en-gb")) "en-GB" else "en-US",
            rawText = text,
            hour = hour,
            minute = minute
        )
    }

    private fun buildEvent(
        title: String,
        location: String?,
        language: String,
        rawText: String,
        hour: Int,
        minute: Int
    ): JSONObject {
        val start = ZonedDateTime.now(ZoneId.systemDefault())
            .plusDays(1)
            .withHour(hour)
            .withMinute(minute)
            .withSecond(0)
            .withNano(0)
        val end = start.plusHours(1)
        return JSONObject()
            .put("intent", "create_event")
            .put("title", title)
            .put("start", formatter.format(start))
            .put("end", formatter.format(end))
            .put("timezone", start.zone.id)
            .put("location", location)
            .put("attendees", JSONArray())
            .put("reminders", JSONArray().put(JSONObject().put("method", "popup").put("minutes", 15)))
            .put("language", language)
            .put("raw_text", rawText)
    }
}
