package com.example.messenger.UI.Fragments

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.ChatAdapter
import com.example.messenger.UI.Adapters.ContactSectionAdapter
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.LocalRepository
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.databinding.DialogOpenChatBinding
import com.example.messenger.databinding.FragmentChatsBinding
import com.example.messenger.domain.viewmodels.ChatsViewModel
import androidx.core.graphics.drawable.toDrawable
import com.example.messenger.UI.Chat
import kotlin.jvm.java

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

        viewModel.chats.observe(viewLifecycleOwner) { chats ->
            chatsList.clear()
            chatsList.addAll(chats)
            chatAdapter.notifyDataSetChanged()
            binding.tvNoChats.visibility = if (chats.isEmpty()) View.VISIBLE else View.GONE
            binding.rvChats.visibility = if (chats.isEmpty()) View.GONE else View.VISIBLE
        }

        val userId = prefs.getInt("user_id", 0)
        viewModel.loadChats(userId)

        binding.btnAddChat.setOnClickListener {
            val binding = DialogOpenChatBinding.inflate(LayoutInflater.from(requireContext()))

            val dialog = AlertDialog.Builder(requireContext())
                .setView(binding.root)
                .setCancelable(true)
                .create()

            binding.btnCreateGroup.setOnClickListener { dialog.dismiss() }

            binding.btnCreateContact.setOnClickListener { dialog.dismiss() }

            binding.btnCreateChannel.setOnClickListener { dialog.dismiss() }

            viewModel.contacts.observe(viewLifecycleOwner) { contacts ->
                val groupedContacts = contacts
                    .groupBy { it.nickname.first().uppercase() }
                    .map { it.key to it.value }
                    .sortedBy { it.first }

                val adapter = ContactSectionAdapter(groupedContacts) { contact ->
                    dialog.dismiss()
                    val intent = Intent(requireContext(), Chat::class.java).apply {
                        putExtra("currentUserId", currentUserId)
                        putExtra("otherUsername", contact.username)
                    }
                    startActivity(intent)
                }

                binding.rvContacts.layoutManager = LinearLayoutManager(requireContext())
                binding.rvContacts.adapter = adapter
            }

            viewModel.loadContacts()

            dialog.show()
            dialog.window?.setBackgroundDrawable(
                android.graphics.Color.TRANSPARENT.toDrawable()
            )
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}