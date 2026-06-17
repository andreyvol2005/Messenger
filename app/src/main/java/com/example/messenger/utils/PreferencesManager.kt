package com.example.messenger.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

class PreferencesManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences("app_prefs", Context.MODE_PRIVATE)

    fun saveUserId(userId: Int) {
        prefs.edit { putInt("user_id", userId) }
    }

    fun getUserId(): Int {
        return prefs.getInt("user_id", -1)
    }

    fun clear() {
        prefs.edit { clear() }
    }
}