package com.example.messenger.UI

import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.EditText
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.LinearLayoutManager
//import com.example.messenger.Adapters.Contact
import com.example.messenger.UI.Adapters.ContactsAdapter
import com.example.messenger.databinding.ActivityCreateChatBinding

class CreateChat : AppCompatActivity() {

    private lateinit var binding: ActivityCreateChatBinding
    private lateinit var contactsAdapter: ContactsAdapter
//    private val contactsList = mutableListOf<Contact>()
    private var currentUsername: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        binding = ActivityCreateChatBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top
            v.setPadding(0, top, 0, 0)
            insets
        }

        currentUsername = intent.getStringExtra("currentUsername") ?: ""

        binding.btnBack.setOnClickListener { finish() }

        binding.btnCreateGroup.setOnClickListener {
        }

        binding.btnCreateContact.setOnClickListener {
            val input = EditText(this).apply {
                hint = "@username"
                inputType = InputType.TYPE_CLASS_TEXT
            }

            AlertDialog.Builder(this)
                .setTitle("Новый чат")
                .setView(input)
                .setPositiveButton("Создать") { _, _ ->
                    val otherUser = input.text.toString().trim()
                    if (otherUser.isNotEmpty() && otherUser != currentUsername) {
                    }
                }
                .setNegativeButton("Отмена", null)
                .show()
        }

//        contactsAdapter = ContactsAdapter(contactsList, currentUsername) { contact ->
//            openChatWithContact(contact)
//        }
        binding.rvContacts.layoutManager = LinearLayoutManager(this)
        binding.rvContacts.adapter = contactsAdapter

        loadContacts()
    }

    private fun loadContacts() {
    }

//    private fun openChatWithContact(contact: Contact) {
//    }
}