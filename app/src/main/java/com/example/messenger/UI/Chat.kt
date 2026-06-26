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
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.R
import com.example.messenger.UI.Adapters.MessagesAdapter
import com.example.messenger.data.LocalRepository
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.MessageEntity
import com.example.messenger.databinding.ActivityChatBinding
import com.example.messenger.domain.viewmodels.ChatViewModel

class Chat : AppCompatActivity() {

    private lateinit var binding: ActivityChatBinding
    private lateinit var messagesAdapter: MessagesAdapter
    private val messagesList = mutableListOf<MessageEntity>()

    private val viewModel: ChatViewModel by viewModels {
        object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val db = AppDatabase.getDatabase(this@Chat)
                val repository = LocalRepository(db)
                return ChatViewModel(repository) as T
            }
        }
    }

    private var chatId: Int = 0
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

        chatId = intent.getIntExtra("chatId", 0)
        currentUserId = intent.getIntExtra("currentUserId", 0)
        otherUsername = intent.getStringExtra("otherUsername") ?: ""

        if (currentUserId == 0 || otherUsername.isEmpty()) {
            Toast.makeText(this, "Ошибка открытия чата", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        // Подписка на заголовок
        viewModel.chatTitle.observe(this) { title ->
            binding.tvTitle.text = title
        }

        // Подписка на сообщения
        viewModel.messages.observe(this) { messages ->
            messagesList.clear()
            messagesList.addAll(messages)
            messagesAdapter.notifyDataSetChanged()
            if (messages.isNotEmpty()) {
                binding.rvMessages.scrollToPosition(messages.size - 1)
            }
        }

        viewModel.error.observe(this) { error ->
            error?.let {
                Toast.makeText(this, it, Toast.LENGTH_SHORT).show()
            }
        }

        // Настройка адаптера
        messagesAdapter = MessagesAdapter(messagesList, currentUserId)
        binding.rvMessages.layoutManager = LinearLayoutManager(this)
        binding.rvMessages.adapter = messagesAdapter

        binding.btnBack.setOnClickListener { finish() }
        binding.btnSend.setOnClickListener { sendMessage() }

        // Если chatId есть — загружаем чат, иначе ищем/создаём
        if (chatId != 0) {
            loadChatData()
        } else {
            findOrCreateChat()
        }
    }

    private fun findOrCreateChat() {
        // TODO: реализовать поиск или создание чата
        Toast.makeText(this, "Поиск/создание чата с $otherUsername", Toast.LENGTH_SHORT).show()
        // Временно используем заглушку
        chatId = 1
        loadChatData()
    }

    private fun loadChatData() {
        viewModel.loadChatTitle(otherUsername)
        viewModel.loadMessages(chatId)
    }

    private fun sendMessage() {
        val text = binding.etMessage.text.toString().trim()
        if (text.isEmpty()) {
            Toast.makeText(this, "Введите сообщение", Toast.LENGTH_SHORT).show()
            return
        }

        binding.etMessage.setText("")
        viewModel.sendMessage(chatId, currentUserId, text)
    }

    override fun onDestroy() {
        super.onDestroy()
    }
}