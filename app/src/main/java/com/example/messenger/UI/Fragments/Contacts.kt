package com.example.messenger.UI.Fragments

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.text.InputType
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.ContactsAdapter
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.network.AddContactRequest
import com.example.messenger.network.RetrofitClient
import com.example.messenger.data.LocalRepository
import com.example.messenger.databinding.FragmentContactsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class Contacts : Fragment() {

    private var _binding: FragmentContactsBinding? = null
    private val binding get() = _binding!!

    private lateinit var contactsAdapter: ContactsAdapter
    private lateinit var localRepository: LocalRepository
    private val contactsList = mutableListOf<ContactEntity>()
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    private var currentUserId: Int = 0
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

        currentUserId = prefs.getInt("user_id", 0)
        currentUsername = prefs.getString("username", "") ?: ""

        if (currentUserId == 0) {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        val db = AppDatabase.getDatabase(requireContext())
        localRepository = LocalRepository(db)

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
        lifecycleScope.launch {
            try {
                // 1. Найти пользователя по username
                val api = RetrofitClient.apiService
                val user = api.getUserByUsername(otherUsername)

                // 2. Добавить контакт на сервере
                val response = api.addContact(currentUserId, AddContactRequest(user.id))

                withContext(Dispatchers.Main) {
                    Toast.makeText(requireContext(), "Контакт добавлен", Toast.LENGTH_SHORT).show()
                    loadContacts() // обновляем список
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(requireContext(), "Ошибка: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    @SuppressLint("NotifyDataSetChanged")
    private fun loadContacts() {
        lifecycleScope.launch {
            // 1. Сначала из локальной БД
            val localContacts = localRepository.getAllContacts()
            if (localContacts.isNotEmpty()) {
                contactsList.clear()
                contactsList.addAll(localContacts)
                contactsAdapter.notifyDataSetChanged()
                binding.tvNoContacts.visibility = View.GONE
                binding.rvContacts.visibility = View.VISIBLE
            }

            // 2. Обновляем с сервера
            try {
                val api = RetrofitClient.apiService
                val contacts = api.getContacts(currentUserId)

                if (contacts.isNotEmpty()) {
                    val contactEntities = contacts.map {
                        ContactEntity(
                            id = it.id,
                            username = it.username,
                            nickname = it.nickname,
                            avatarUrl = it.avatarUrl
                        )
                    }
                    localRepository.saveContacts(contactEntities)

                    contactsList.clear()
                    contactsList.addAll(contactEntities)
                    contactsAdapter.notifyDataSetChanged()
                    binding.tvNoContacts.visibility = View.GONE
                    binding.rvContacts.visibility = View.VISIBLE
                } else {
                    if (contactsList.isEmpty()) {
                        binding.tvNoContacts.visibility = View.VISIBLE
                        binding.rvContacts.visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                if (contactsList.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(requireContext(), "Ошибка загрузки контактов", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun openChatWithContact(otherUsername: String) {
        Toast.makeText(requireContext(), "Чат с $otherUsername", Toast.LENGTH_SHORT).show()
        // TODO: открыть чат с контактом
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}