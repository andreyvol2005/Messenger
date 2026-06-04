package com.example.messenger.Fragments

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.Adapters.ChatAdapter
import com.example.messenger.CreateChat
import com.example.messenger.DataClasses.LS
import com.example.messenger.DataClasses.User
import com.example.messenger.databinding.FragmentChatsBinding
import com.google.firebase.firestore.FirebaseFirestore

class Chats : Fragment() {

    private var _binding: FragmentChatsBinding? = null
    private val binding get() = _binding!!

    private lateinit var chatAdapter: ChatAdapter
    private val db = FirebaseFirestore.getInstance()
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", android.content.Context.MODE_PRIVATE) }
    private val chatsList = mutableListOf<LS>()

    private var currentUsername: String = ""
    private val snapshots = mutableListOf<com.google.firebase.firestore.ListenerRegistration>()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentChatsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUsername = prefs.getString("user", "none") ?: "none"

        if (currentUsername == "none") {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        chatAdapter = ChatAdapter(chatsList, currentUsername)
        binding.rvChats.layoutManager = LinearLayoutManager(requireContext())
        binding.rvChats.adapter = chatAdapter

        binding.btnAddChat.setOnClickListener {
            val intent = Intent(requireContext(), CreateChat::class.java)
            intent.putExtra("currentUsername", currentUsername)
            startActivity(intent)
        }

        loadUserChats()
    }

    private fun loadUserChats() {
        db.collection("Users")
            .whereEqualTo("username", currentUsername)
            .get()
            .addOnSuccessListener { users ->
                if (users.isEmpty()) {
                    binding.tvNoChats.visibility = View.VISIBLE
                    binding.rvChats.visibility = View.GONE
                    return@addOnSuccessListener
                }

                val user = users.first().toObject(User::class.java)
                val chatIds = user.chats

                if (chatIds.isEmpty()) {
                    binding.tvNoChats.visibility = View.VISIBLE
                    binding.rvChats.visibility = View.GONE
                    return@addOnSuccessListener
                }

                subscribeToChats(chatIds)
            }
            .addOnFailureListener {
                Toast.makeText(requireContext(), "Ошибка загрузки", Toast.LENGTH_SHORT).show()
            }
    }

    private fun subscribeToChats(chatIds: List<String>) {
        chatsList.clear()
        snapshots.clear()

        for (chatId in chatIds) {
            val listener = db.collection("LS").document(chatId)
                .addSnapshotListener { snapshot, error ->
                    if (error != null || snapshot == null) return@addSnapshotListener
                    if (_binding == null) return@addSnapshotListener

                    if (snapshot.exists()) {
                        val chat = snapshot.toObject(LS::class.java)
                        if (chat != null) {
                            val chatWithId = chat.copy(id = snapshot.id)

                            // Загружаем данные собеседника (nickname и avatarUrl)
                            val members = chatWithId.members
                            val otherUsername = members.find { it != currentUsername } ?: members.firstOrNull() ?: ""

                            if (otherUsername.isNotEmpty()) {
                                db.collection("Users").whereEqualTo("username", otherUsername).get()
                                    .addOnSuccessListener { userDocs ->
                                        if (userDocs.isEmpty()) return@addOnSuccessListener
                                        val otherUser = userDocs.first().toObject(User::class.java)

                                        val updatedChat = chatWithId.copy(
                                            members = listOf(otherUsername),
                                            partnerNickname = otherUser.nickname.ifEmpty { otherUsername },
                                            partnerAvatarUrl = otherUser.avatarUrl
                                        )

                                        updateChatList(updatedChat)
                                    }
                            } else {
                                updateChatList(chatWithId)
                            }
                        }
                    }
                }
            snapshots.add(listener)
        }
    }

    private fun updateChatList(chat: LS) {
        if (_binding == null) return
        val index = chatsList.indexOfFirst { it.id == chat.id }
        if (index != -1) {
            chatsList[index] = chat
        } else {
            chatsList.add(chat)
        }

        chatsList.sortByDescending { it.time }
        chatAdapter.notifyDataSetChanged()

        if (chatsList.isEmpty()) {
            binding.tvNoChats.visibility = View.VISIBLE
            binding.rvChats.visibility = View.GONE
        } else {
            binding.tvNoChats.visibility = View.GONE
            binding.rvChats.visibility = View.VISIBLE
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        snapshots.forEach { it.remove() }
        snapshots.clear()
        _binding = null
    }
}