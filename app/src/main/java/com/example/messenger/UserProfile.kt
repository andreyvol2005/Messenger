package com.example.messenger

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.bumptech.glide.Glide
import com.example.messenger.databinding.ActivityUserProfileBinding
import com.google.firebase.firestore.FirebaseFirestore

class UserProfile : AppCompatActivity() {

    private lateinit var binding: ActivityUserProfileBinding
    private val db = FirebaseFirestore.getInstance()
    private var userId: String = ""
    private var username: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        enableEdgeToEdge()

        binding = ActivityUserProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            v.setPadding(0, top, 0, bottom)
            insets
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.decorView.windowInsetsController?.let {
                it.hide(WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    )
        }

        userId = intent.getStringExtra("userId") ?: ""
        username = intent.getStringExtra("username") ?: ""

        binding.btnBack.setOnClickListener { finish() }

        loadUserProfile()
    }

    private fun loadUserProfile() {
        db.collection("Users").document(userId).get()
            .addOnSuccessListener { doc ->
                if (!doc.exists()) {
                    Toast.makeText(this, "Пользователь не найден", Toast.LENGTH_SHORT).show()
                    finish()
                    return@addOnSuccessListener
                }

                val nickname = doc.getString("nickname") ?: username
                val bio = doc.getString("bio") ?: "Нет описания"
                val birthDate = doc.getString("birthDate") ?: "Не указана"
                val avatarUrl = doc.getString("avatarUrl")

                binding.tvDisplayName.text = nickname
                binding.tvUsername.text = "@$username"
                binding.tvBio.text = bio
                binding.tvBirthDate.text = birthDate

                if (!avatarUrl.isNullOrEmpty()) {
                    Glide.with(this)
                        .load(avatarUrl)
                        .placeholder(R.drawable.ic_avatar_default)
                        .into(binding.ivAvatar)
                }
            }
            .addOnFailureListener {
                Toast.makeText(this, "Ошибка загрузки профиля", Toast.LENGTH_SHORT).show()
                finish()
            }
    }
}