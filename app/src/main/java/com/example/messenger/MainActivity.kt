package com.example.messenger

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import com.example.messenger.Fragments.Chats
import com.example.messenger.Fragments.Contacts
import com.example.messenger.Fragments.Profile
import com.example.messenger.Fragments.Settings
import com.example.messenger.databinding.ActivityMainBinding
import com.google.firebase.FirebaseApp

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )

        FirebaseApp.initializeApp(this)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            v.setPadding(0, top, 0, 0)
            insets
        }

        val prefs = getSharedPreferences("app_prefs", Context.MODE_PRIVATE)
        if (!prefs.contains("user")) {
            prefs.edit { putString("user", "none") }
        }

        handleIntent(intent)
        setupNavigation()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val openFragment = intent.getStringExtra("open_fragment")
        val fragment = when (openFragment) {
            "contacts" -> Contacts()
            "profile" -> Profile()
            "settings" -> Settings()
            else -> Chats()
        }
        replaceFragment(fragment)

        val navItem = when (openFragment) {
            "contacts" -> binding.navContacts
            "profile" -> binding.navProfile
            "settings" -> binding.navSettings
            else -> binding.navChats
        }
        setActiveNavItem(navItem)
    }

    private fun setupNavigation() {
        binding.navChats.setOnClickListener {
            replaceFragment(Chats())
            setActiveNavItem(binding.navChats)
        }

        binding.navContacts.setOnClickListener {
            replaceFragment(Contacts())
            setActiveNavItem(binding.navContacts)
        }

        binding.navProfile.setOnClickListener {
            replaceFragment(Profile())
            setActiveNavItem(binding.navProfile)
        }

        binding.navSettings.setOnClickListener {
            replaceFragment(Settings())
            setActiveNavItem(binding.navSettings)
        }
    }

    private fun replaceFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    private fun setActiveNavItem(selectedItem: View) {
        resetNavItem(binding.navChats)
        resetNavItem(binding.navContacts)
        resetNavItem(binding.navProfile)
        resetNavItem(binding.navSettings)

        when (selectedItem.id) {
            R.id.nav_chats -> {
                binding.icChats.setColorFilter(resources.getColor(android.R.color.holo_blue_dark))
                binding.tvChats.setTextColor(resources.getColor(android.R.color.holo_blue_dark))
            }
            R.id.nav_contacts -> {
                binding.icContacts.setColorFilter(resources.getColor(android.R.color.holo_blue_dark))
                binding.tvContacts.setTextColor(resources.getColor(android.R.color.holo_blue_dark))
            }
            R.id.nav_profile -> {
                binding.icProfile.setColorFilter(resources.getColor(android.R.color.holo_blue_dark))
                binding.tvProfile.setTextColor(resources.getColor(android.R.color.holo_blue_dark))
            }
            R.id.nav_settings -> {
                binding.icSettings.setColorFilter(resources.getColor(android.R.color.holo_blue_dark))
                binding.tvSettings.setTextColor(resources.getColor(android.R.color.holo_blue_dark))
            }
        }
    }

    private fun resetNavItem(navItem: View) {
        when (navItem.id) {
            R.id.nav_chats -> {
                binding.icChats.setColorFilter(resources.getColor(android.R.color.darker_gray))
                binding.tvChats.setTextColor(resources.getColor(android.R.color.darker_gray))
            }
            R.id.nav_contacts -> {
                binding.icContacts.setColorFilter(resources.getColor(android.R.color.darker_gray))
                binding.tvContacts.setTextColor(resources.getColor(android.R.color.darker_gray))
            }
            R.id.nav_profile -> {
                binding.icProfile.setColorFilter(resources.getColor(android.R.color.darker_gray))
                binding.tvProfile.setTextColor(resources.getColor(android.R.color.darker_gray))
            }
            R.id.nav_settings -> {
                binding.icSettings.setColorFilter(resources.getColor(android.R.color.darker_gray))
                binding.tvSettings.setTextColor(resources.getColor(android.R.color.darker_gray))
            }
        }
    }

}