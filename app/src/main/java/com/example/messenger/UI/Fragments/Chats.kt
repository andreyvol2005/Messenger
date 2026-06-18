package com.example.messenger.UI.Fragments

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.ChatAdapter
import com.example.messenger.UI.CreateChat
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.models.ChatDto
import com.example.messenger.network.RetrofitClient
import com.example.messenger.data.LocalRepository
import com.example.messenger.databinding.FragmentChatsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class Chats : Fragment() {

    private var _binding: FragmentChatsBinding? = null
    private val binding get() = _binding!!

    private lateinit var chatAdapter: ChatAdapter
    private lateinit var localRepository: LocalRepository
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    private val chatsList = mutableListOf<ChatEntity>()
    private var currentUserId: Int = 0

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUserId = prefs.getInt("user_id", 0)

        if (currentUserId == 0) {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        val db = AppDatabase.getDatabase(requireContext())
        localRepository = LocalRepository(db)

        chatAdapter = ChatAdapter(chatsList)
        binding.rvChats.layoutManager = LinearLayoutManager(requireContext())
        binding.rvChats.adapter = chatAdapter

        binding.btnAddChat.setOnClickListener {
            val intent = Intent(requireContext(), CreateChat::class.java)
            intent.putExtra("currentUserId", currentUserId)
            startActivity(intent)
        }

        loadUserChats()
    }

    @SuppressLint("NotifyDataSetChanged")
    private fun loadUserChats() {
        lifecycleScope.launch {
            // 1. Сначала из локальной БД
            val localChats = localRepository.getAllChats()
            if (localChats.isNotEmpty()) {
                chatsList.clear()
                chatsList.addAll(localChats)
                chatAdapter.notifyDataSetChanged()
                binding.tvNoChats.visibility = View.GONE
                binding.rvChats.visibility = View.VISIBLE
            }

            // 2. Обновляем с сервера
            try {
                val api = RetrofitClient.apiService
                val chats = api.getUserChats(currentUserId)

                if (chats.isNotEmpty()) {
                    val chatEntities = chats.map { it.toEntity() }
                    localRepository.saveChats(chatEntities)

                    chatsList.clear()
                    chatsList.addAll(chatEntities)
                    chatAdapter.notifyDataSetChanged()
                    binding.tvNoChats.visibility = View.GONE
                    binding.rvChats.visibility = View.VISIBLE
                } else {
                    if (chatsList.isEmpty()) {
                        binding.tvNoChats.visibility = View.VISIBLE
                        binding.rvChats.visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                if (chatsList.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(requireContext(), "${e}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun ChatDto.toEntity(): ChatEntity {
        return ChatEntity(
            id = id,
            type = type,
            name = name,
            lastMessageText = lastMessage?.text,
            lastMessageTime = lastMessage?.createdAt?.let { parseTime(it) },
            partnerId = partner?.id,
            partnerUsername = partner?.username,
            partnerNickname = partner?.nickname,
            partnerAvatarUrl = partner?.avatarUrl,
            unreadCount = unreadCount,
            createdAt = null
        )
    }

    private fun parseTime(timeString: String): Long? {
        return try {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSSSS", java.util.Locale.getDefault())
                .parse(timeString)?.time
        } catch (e: Exception) {
            try {
                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSSSS", java.util.Locale.getDefault())
                    .parse(timeString)?.time
            } catch (e2: Exception) {
                null
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}