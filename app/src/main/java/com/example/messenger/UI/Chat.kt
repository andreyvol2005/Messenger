package com.example.messenger.UI

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.viewModels
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.example.messenger.data.LocalRepository
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.databinding.ActivityChatBinding
import com.example.messenger.domain.viewmodels.ChatViewModel

class Chat : AppCompatActivity() {

    private lateinit var binding: ActivityChatBinding

    private val viewModel: ChatViewModel by viewModels {
        object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val db = AppDatabase.getDatabase(this@Chat)
                val repository = LocalRepository(db)
                return ChatViewModel(repository) as T
            }
        }
    }

    private var currentUserId: Int = 0
    private var otherUsername: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            val bottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            v.setPadding(0, top, 0, bottom)
            insets
        }

        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )

        currentUserId = intent.getIntExtra("currentUserId", 0)
        otherUsername = intent.getStringExtra("otherUsername") ?: ""

        if (currentUserId == 0 || otherUsername.isEmpty()) {
            Toast.makeText(this, "Ошибка: не хватает данных", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        // Подписка на заголовок чата
        viewModel.chatTitle.observe(this) { title ->
            binding.tvTitle.text = title
        }

        viewModel.error.observe(this) { error ->
            error?.let {
                Toast.makeText(this, it, Toast.LENGTH_SHORT).show()
                finish()
            }
        }

        binding.btnBack.setOnClickListener { finish() }
        binding.btnSend.setOnClickListener {
            Toast.makeText(this, "Отправка сообщения (заглушка)", Toast.LENGTH_SHORT).show()
            binding.etMessage.setText("")
        }

        // Загружаем или создаём чат
        viewModel.loadOrCreateChat(currentUserId, otherUsername)
    }

    override fun onDestroy() {
        super.onDestroy()
    }
}