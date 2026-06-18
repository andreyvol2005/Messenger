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
import androidx.fragment.app.viewModels
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.messenger.UI.Adapters.ContactsAdapter
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.LocalRepository
import com.example.messenger.databinding.FragmentContactsBinding
import com.example.messenger.domain.viewmodels.ContactsViewModel
import kotlinx.coroutines.launch

class Contacts : Fragment() {

    private var _binding: FragmentContactsBinding? = null
    private val binding get() = _binding!!
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }

    private val viewModel: ContactsViewModel by viewModels {
        object : androidx.lifecycle.ViewModelProvider.Factory {
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
                val db = AppDatabase.getDatabase(requireContext())
                val repository = LocalRepository(db)
                return ContactsViewModel(repository) as T
            }
        }
    }

    private lateinit var contactsAdapter: ContactsAdapter
    private val contactsList = mutableListOf<ContactEntity>()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentContactsBinding.inflate(inflater, container, false)
        return binding.root
    }

    @SuppressLint("NotifyDataSetChanged")
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val userId = prefs.getInt("user_id", 0)

        viewModel.contacts.observe(viewLifecycleOwner) { contacts ->
            contactsList.clear()
            contactsList.addAll(contacts)
            contactsAdapter.notifyDataSetChanged()
            binding.tvNoContacts.visibility = if (contacts.isEmpty()) View.VISIBLE else View.GONE
            binding.rvContacts.visibility = if (contacts.isEmpty()) View.GONE else View.VISIBLE
        }

        contactsAdapter = ContactsAdapter(contactsList) { contact ->
            openChatWithContact(contact)
        }

        binding.rvContacts.layoutManager = LinearLayoutManager(requireContext())
        binding.rvContacts.adapter = contactsAdapter

        binding.btnAddContact.setOnClickListener {
            showAddContactDialog()
        }

        viewModel.loadContacts(userId)
    }

    private fun showAddContactDialog() {
        val input = EditText(requireContext()).apply {
            hint = "@username"
            inputType = InputType.TYPE_CLASS_TEXT
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Добавить контакт")
            .setMessage("Введите имя пользователя")
            .setView(input)
            .setPositiveButton("Добавить") { _, _ ->
                val username = input.text.toString().trim()
                if (username.isNotEmpty()) {
                    addContact(username)
                } else {
                    Toast.makeText(requireContext(), "Введите имя пользователя", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun addContact(username: String) {
        lifecycleScope.launch {
            val userId = prefs.getInt("user_id", 0)
            viewModel.addContact(userId, username)
            Toast.makeText(requireContext(), "Контакт добавлен", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openChatWithContact(contact: ContactEntity) {
        Toast.makeText(requireContext(), "Чат с ${contact.nickname}", Toast.LENGTH_SHORT).show()
        // TODO: открыть чат с контактом
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}