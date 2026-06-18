package com.example.messenger.UI

import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.MessagesAdapter
//import com.example.messenger.DataClasses.Message
import com.example.messenger.databinding.ActivityChatBinding

class Chat : AppCompatActivity() {

    private lateinit var binding: ActivityChatBinding
    private lateinit var messagesAdapter: MessagesAdapter
//    private val messagesList = mutableListOf<Message>()

    private var chatId: String = ""
    private var currentUsername: String = ""
    private var otherUsername: String = ""
    private var currentUserIndex: Int = 0
    private var otherUserNickname: String = ""

    private var replyingToId: String? = null
    private var replyingToText: String? = null
    private var replyingToSender: String? = null
    private var otherUserId: String = ""

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
        enableEdgeToEdge()

        chatId = intent.getStringExtra("chatId") ?: ""
//        db.collection("LS").document(chatId).update("unread", 0)
        otherUsername = intent.getStringExtra("otherUsername") ?: ""
        currentUsername = intent.getStringExtra("currentUsername") ?: ""
        currentUserIndex = intent.getIntExtra("userIndex", 0)

//        messagesAdapter = MessagesAdapter(messagesList, currentUserIndex, chatId, otherUsername)
        binding.rvMessages.layoutManager = LinearLayoutManager(this)
        binding.rvMessages.adapter = messagesAdapter

//        db.collection("Users").whereEqualTo("username", otherUsername).get()
//            .addOnSuccessListener { users ->
//                val user = users.first().toObject(UserDto::class.java)
//                otherUserNickname = if (user.nickname.isNotEmpty()) user.nickname else otherUsername
//                binding.tvTitle.text = otherUserNickname
//                // Обновляем адаптер с правильным ником
//                messagesAdapter = MessagesAdapter(messagesList, currentUserIndex, chatId, otherUserNickname)
//                binding.rvMessages.adapter = messagesAdapter
//                messagesAdapter.notifyDataSetChanged()
//            }

        loadOtherUserData()
        binding.ivAvatar.setOnClickListener {
            if (otherUserId.isNotEmpty()) {
                val intent = Intent(this, UserProfile::class.java).apply {
                    putExtra("userId", otherUserId)
                    putExtra("username", otherUsername)
                }
                startActivity(intent)
            }
        }

        binding.btnBack.setOnClickListener { finish() }
        binding.btnSend.setOnClickListener { sendMessage() }

        if (chatId.isNotEmpty()) {
            loadMessages()
        } else {
            Toast.makeText(this, "Ошибка: ID чата не передан", Toast.LENGTH_SHORT).show()
            finish()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (replyingToId != null) {
                    cancelReply()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        binding.root.viewTreeObserver.addOnGlobalLayoutListener {
            val rect = Rect()
            binding.root.getWindowVisibleDisplayFrame(rect)
            val screenHeight = binding.root.height
            val keypadHeight = screenHeight - rect.bottom

            if (keypadHeight > screenHeight * 0.15) {
//                if (messagesList.isNotEmpty()) {
//                    binding.rvMessages.scrollToPosition(messagesList.size - 1)
//                }
            }
        }
    }

    fun showReplyBar(senderName: String, messageText: String, messageId: String) {
        replyingToId = messageId
        replyingToText = messageText
        replyingToSender = senderName

        binding.replyBar.visibility = View.VISIBLE
        binding.tvReplySender.text = senderName
        binding.tvReplyText.text = messageText.take(50)
        binding.etMessage.requestFocus()
    }

    private fun cancelReply() {
        replyingToId = null
        replyingToText = null
        replyingToSender = null
        binding.replyBar.visibility = View.GONE
        binding.etMessage.hint = "Сообщение..."
    }

    private fun sendMessage() {
        var text = binding.etMessage.text.toString().trim()
        if (text.isEmpty()) return
        if (text.length > 5000) {
            text = text.take(5000)
            Toast.makeText(this, "Сообщение обрезано до 5000 символов", Toast.LENGTH_SHORT).show()
        }
        if (replyingToId != null) {
            sendReply()
        } else {
            sendPlainMessage(text)
        }
    }

    private fun sendReply() {
        val text = binding.etMessage.text.toString().trim()
        if (text.isEmpty() || replyingToId == null) return

        val message = hashMapOf<String, Any>(
            "from" to currentUserIndex,
            "text" to text,
            "time" to System.currentTimeMillis().toString(),
            "read" to 0,
            "replyToId" to replyingToId!!
        )

//        db.collection("LS").document(chatId)
//            .collection("messages")
//            .add(message)
//            .addOnSuccessListener {
//                binding.etMessage.setText("")
//                db.collection("LS").document(chatId)
//                    .update("lastMsg", text, "time", System.currentTimeMillis())
//                cancelReply()
//            }
    }

    private fun sendPlainMessage(text: String) {
        val message = hashMapOf<String, Any>(
            "from" to currentUserIndex,
            "text" to text,
            "time" to System.currentTimeMillis().toString(),
            "read" to 1
        )

//        db.collection("LS").document(chatId)
//            .collection("messages")
//            .add(message)
//            .addOnSuccessListener {
//                binding.etMessage.setText("")
//                db.collection("LS").document(chatId)
//                    .update(
//                        "lastMsg", text,
//                        "time", System.currentTimeMillis(),
//                        "lastread", 1,
//                        "lastSender", currentUsername,
//                        "unread", FieldValue.increment(1)
//                    )
//            }
    }

    private fun loadMessages() {
//        val chatRef = db.collection("LS").document(chatId)
//
//        chatRef.addSnapshotListener { chatDoc, _ ->
//            if (chatDoc == null || !chatDoc.exists()) return@addSnapshotListener
//
//            val members = chatDoc.get("members") as? List<*> ?: emptyList<Any>()
//            currentUserIndex = members.indexOf(currentUsername)
//
//            chatRef.collection("messages")
//                .orderBy("time")
//                .addSnapshotListener { snapshot, _ ->
//                    messagesList.clear()
//                    for (doc in snapshot?.documents ?: emptyList()) {
//                        val message = doc.toObject(Message::class.java)?.copy(id = doc.id)
//                        if (message != null) {
//                            messagesList.add(message)
//
//                            if (message.from != currentUserIndex && message.read != 2) {
//                                doc.reference.update("read", 2)
//                                chatRef.update("lastread", 2)
//                            }
//                        }
//                    }
//                    messagesAdapter.notifyDataSetChanged()
//                    if (messagesList.isNotEmpty()) {
//                        binding.rvMessages.postDelayed({
//                            binding.rvMessages.scrollToPosition(messagesList.size - 1)
//                        }, 100)
//                    }
//                }
//        }
    }

    private fun loadOtherUserData() {
//        db.collection("Users").whereEqualTo("username", otherUsername).get()
//            .addOnSuccessListener { users ->
//                if (users.isEmpty()) return@addOnSuccessListener
//                val user = users.first().toObject(UserDto::class.java)
//                otherUserId = users.first().id
//                otherUserNickname = if (user.nickname.isNotEmpty()) user.nickname else otherUsername
//                binding.tvTitle.text = otherUserNickname
//
//                val avatarUrl = user.avatarUrl
//                if (!avatarUrl.isNullOrEmpty()) {
//                    Glide.with(this)
//                        .load(avatarUrl)
//                        .placeholder(R.drawable.ic_avatar_default)
//                        .error(R.drawable.ic_avatar_default)
//                        .into(binding.ivAvatar)
//                } else {
//                    binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
//                }
//            }
    }
}