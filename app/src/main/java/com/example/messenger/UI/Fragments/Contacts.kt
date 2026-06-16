package com.example.messenger.UI.Fragments

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.Adapters.Contact
import com.example.messenger.UI.Adapters.ContactsAdapter
import com.example.messenger.UI.Chat
import com.example.messenger.databinding.FragmentContactsBinding

class Contacts : Fragment() {

    private var _binding: FragmentContactsBinding? = null
    private val binding get() = _binding!!

    private lateinit var contactsAdapter: ContactsAdapter
    private val contactsList = mutableListOf<Contact>()
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    private var currentUsername: String = ""

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentContactsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUsername = prefs.getString("user", "none") ?: "none"
        if (currentUsername == "none") {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        contactsAdapter = ContactsAdapter(contactsList, currentUsername) { contact ->
            openChatWithContact(contact.username)
        }

        binding.rvContacts.layoutManager = LinearLayoutManager(requireContext())
        binding.rvContacts.adapter = contactsAdapter

        binding.btnAddContact.setOnClickListener {
            val input = EditText(requireContext()).apply {
                hint = "@username"
                inputType = InputType.TYPE_CLASS_TEXT
            }

            AlertDialog.Builder(requireContext())
                .setTitle("Добавить контакт")
                .setMessage("Введите имя пользователя")
                .setView(input)
                .setPositiveButton("Добавить") { _, _ ->
                    val newContact = input.text.toString().trim()
                    if (newContact.isNotEmpty() && newContact != currentUsername) {
                        addContact(newContact)
                    } else {
                        Toast.makeText(requireContext(), "Введите имя пользователя", Toast.LENGTH_SHORT).show()
                    }
                }
                .setNegativeButton("Отмена", null)
                .show()
        }

        loadContacts()
    }

    private fun addContact(otherUsername: String) {
//        db.collection("Users").whereEqualTo("username", otherUsername).get()
//            .addOnSuccessListener { users ->
//                if (users.isEmpty()) {
//                    Toast.makeText(requireContext(), "Пользователь не найден", Toast.LENGTH_SHORT).show()
//                    return@addOnSuccessListener
//                }
//
//                val otherUserId = users.first().id
//
//                db.collection("Users").whereEqualTo("username", currentUsername).get()
//                    .addOnSuccessListener { currentUsers ->
//                        if (currentUsers.isEmpty()) return@addOnSuccessListener
//                        val currentUserDoc = currentUsers.first()
//                        val currentContacts = currentUserDoc.get("contacts") as? List<String> ?: emptyList()
//
//                        if (!currentContacts.contains(otherUserId)) {
//                            currentUserDoc.reference.update("contacts", currentContacts + otherUserId)
//                            Toast.makeText(requireContext(), "Контакт добавлен", Toast.LENGTH_SHORT).show()
//                        } else {
//                            Toast.makeText(requireContext(), "Контакт уже существует", Toast.LENGTH_SHORT).show()
//                        }
//                    }
//            }
    }

    private fun openChatWithContact(otherUsername: String) {
        val members = listOf(currentUsername, otherUsername)
//        db.collection("LS")
//            .whereArrayContains("members", currentUsername)
//            .get()
//            .addOnSuccessListener { chats ->
//                var chatId: String? = null
//                var userIndex = 0
//
//                for (doc in chats) {
//                    val members = doc.get("members") as? List<*> ?: emptyList<Any>()
//                    if (members.contains(otherUsername)) {
//                        chatId = doc.id
//                        userIndex = members.indexOf(currentUsername)
//                        break
//                    }
//                }
//
//                if (chatId == null) {
//                    val newChatId = db.collection("LS").document().id
//                    val members = listOf(currentUsername, otherUsername)
//
//                    db.collection("LS").document(newChatId).set(
//                        mapOf(
//                            "members" to members,
//                            "lastMsg" to "",
//                            "time" to System.currentTimeMillis()
//                        )
//                    ).addOnSuccessListener {
//                        addChatToUser(currentUsername, newChatId)
//                        addChatToUser(otherUsername, newChatId)
//                        openChatActivity(newChatId, otherUsername, 0)
//                    }
//                } else {
//                    openChatActivity(chatId, otherUsername, userIndex)
//                }
//            }
    }

    private fun addChatToUser(username: String, chatId: String) {
//        db.collection("Users").whereEqualTo("username", username).get()
//            .addOnSuccessListener { users ->
//                if (users.isEmpty()) return@addOnSuccessListener
//                val userDoc = users.first()
//                val currentChats = userDoc.get("chats") as? List<String> ?: emptyList()
//                if (!currentChats.contains(chatId)) {
//                    userDoc.reference.update("chats", currentChats + chatId)
//                }
//            }
    }

    private fun openChatActivity(chatId: String, otherUsername: String, userIndex: Int) {
        val intent = Intent(requireContext(), Chat::class.java).apply {
            putExtra("chatId", chatId)
            putExtra("otherUsername", otherUsername)
            putExtra("currentUsername", currentUsername)
            putExtra("userIndex", userIndex)
        }
        startActivity(intent)
    }

    private fun loadContacts() {
        if (_binding == null) return
//        userListener = db.collection("Users").whereEqualTo("username", currentUsername)
//            .addSnapshotListener { users, error ->
//                if (error != null || users == null) return@addSnapshotListener
//                if (_binding == null) return@addSnapshotListener
//
//                if (users.isEmpty()) {
//                    binding.tvNoContacts.visibility = View.VISIBLE
//                    binding.rvContacts.visibility = View.GONE
//                    return@addSnapshotListener
//                }
//
//                val user = users.first().toObject(User::class.java)
//                val contactIds = user.contacts.filter { it.isNotBlank() }
//
//                if (contactIds.isEmpty()) {
//                    binding.tvNoContacts.visibility = View.VISIBLE
//                    binding.rvContacts.visibility = View.GONE
//                    contactsList.clear()
//                    contactsAdapter.notifyDataSetChanged()
//                    return@addSnapshotListener
//                }
//
//                contactsList.clear()
//
//                for (contactId in contactIds) {
//                    db.collection("Users").document(contactId)
//                        .get()
//                        .addOnSuccessListener { doc ->
//                            if (_binding == null) return@addOnSuccessListener
//                            val username = doc.getString("username") ?: ""
//                            val nickname = doc.getString("nickname") ?: ""
//                            val avatarUrl = doc.getString("avatarUrl") ?: ""
//                            // Используем nickname как отображаемое имя, если есть
//                            val displayName = if (nickname.isNotEmpty()) nickname else username
//                            contactsList.add(Contact(displayName, contactId, username, avatarUrl))
//                            contactsAdapter.notifyDataSetChanged()
//                            binding.tvNoContacts.visibility = View.GONE
//                            binding.rvContacts.visibility = View.VISIBLE
//                        }
//                }
//            }
    }

    override fun onDestroyView() {
        super.onDestroyView()
//        userListener?.remove()
        _binding = null
    }
}