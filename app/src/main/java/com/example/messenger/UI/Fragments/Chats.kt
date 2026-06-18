package com.example.messenger.UI.Fragments

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.ChatAdapter
import com.example.messenger.UI.CreateChat
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.LocalRepository
import com.example.messenger.databinding.FragmentChatsBinding
import com.example.messenger.domain.viewmodels.ChatsViewModel

class Chats : Fragment() {

    private var _binding: FragmentChatsBinding? = null
    private val binding get() = _binding!!
    private var currentUserId: Int = 0
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }

    private val viewModel: ChatsViewModel by viewModels {
        object : androidx.lifecycle.ViewModelProvider.Factory {
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
                val db = AppDatabase.getDatabase(requireContext())
                val repository = LocalRepository(db)
                return ChatsViewModel(repository) as T
            }
        }
    }

    private lateinit var chatAdapter: ChatAdapter
    private val chatsList = mutableListOf<ChatEntity>()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatsBinding.inflate(inflater, container, false)
        return binding.root
    }

    @SuppressLint("NotifyDataSetChanged")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUserId = prefs.getInt("user_id", 0)
        chatAdapter = ChatAdapter(chatsList, currentUserId)
        binding.rvChats.layoutManager = LinearLayoutManager(requireContext())
        binding.rvChats.adapter = chatAdapter

        // 2. Потом подписываемся на данные
        viewModel.chats.observe(viewLifecycleOwner) { chats ->
            chatsList.clear()
            chatsList.addAll(chats)
            chatAdapter.notifyDataSetChanged()
            binding.tvNoChats.visibility = if (chats.isEmpty()) View.VISIBLE else View.GONE
            binding.rvChats.visibility = if (chats.isEmpty()) View.GONE else View.VISIBLE
        }

        // 3. Загружаем чаты
        val userId = prefs.getInt("user_id", 0)
        viewModel.loadChats(userId)

        binding.btnAddChat.setOnClickListener {
            startActivity(Intent(requireContext(), CreateChat::class.java))
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}