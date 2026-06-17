package com.example.messenger.UI

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.example.messenger.R
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.repository.LocalRepository
import com.example.messenger.databinding.ActivityUserProfileBinding
import com.example.messenger.network.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class UserProfile : AppCompatActivity() {

    private lateinit var binding: ActivityUserProfileBinding
    private lateinit var localRepository: LocalRepository

    private var userId: Int = 0
    private var username: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        enableEdgeToEdge()

        binding = ActivityUserProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Настройка отступов
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            v.setPadding(0, top, 0, bottom)
            insets
        }

        // Скрываем системную навигацию
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

        // Инициализация Room
        val db = AppDatabase.getDatabase(this)
        localRepository = LocalRepository(db)

        // Получаем данные из Intent
        userId = intent.getIntExtra("userId", 0)
        username = intent.getStringExtra("username") ?: ""

        binding.btnBack.setOnClickListener { finish() }

        // Загружаем профиль
        loadUserProfile()
    }

    private fun loadUserProfile() {
        lifecycleScope.launch {
            val localUser = localRepository.getUser(userId)

            if (localUser != null) {
                displayUser(localUser)
            } else {
                try {
                    val api = RetrofitClient.apiService
                    val user: com.example.messenger.data.models.User = api.getUser(userId)

                    val userEntity = UserEntity(
                        id = user.id,
                        username = user.username,
                        nickname = user.nickname,
                        bio = user.bio,
                        birthDate = user.birthDate,
                        avatarUrl = user.avatarUrl,
                        createdAt = user.createdAt
                    )
                    localRepository.saveUser(userEntity)

                    displayUser(userEntity)
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@UserProfile,
                            "Ошибка загрузки профиля: ${e.message}",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        }
    }

    private fun displayUser(user: UserEntity) {
        binding.tvDisplayName.text = user.nickname
        binding.tvUsername.text = "@${user.username}"
        binding.tvBio.text = user.bio ?: "Нет описания"
        binding.tvBirthDate.text = user.birthDate ?: "Не указана"

        // Загружаем аватарку
        if (!user.avatarUrl.isNullOrEmpty()) {
            Glide.with(this)
                .load(user.avatarUrl)
                .placeholder(R.drawable.ic_avatar_default)
                .error(R.drawable.ic_avatar_default)
                .into(binding.ivAvatar)
        } else {
            binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
        }
    }
}