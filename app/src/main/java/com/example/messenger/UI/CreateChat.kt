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

//        binding.btnCreateGroup.setOnClickListener {
//            val container = LinearLayout(this).apply {
//                orientation = LinearLayout.VERTICAL
//                setPadding(48, 24, 48, 24)
//            }
//
//            val etGroupName = EditText(this).apply {
//                hint = "Название группы"
//                inputType = InputType.TYPE_CLASS_TEXT
//            }
//
//            val tvTitle = TextView(this).apply {
//                text = "Выберите участников"
//                textSize = 14f
//                setPadding(0, 16, 0, 8)
//            }
//
//            val scrollView = ScrollView(this)
//            val contactsContainer = LinearLayout(this).apply {
//                orientation = LinearLayout.VERTICAL
//            }
//            scrollView.addView(contactsContainer)
//
//            container.addView(etGroupName)
//            container.addView(tvTitle)
//            container.addView(scrollView)
//
//            val selectedContacts = mutableSetOf<String>()
//
//            // Загружаем контакты пользователя
//            db.collection("Users").whereEqualTo("username", currentUsername).get()
//                .addOnSuccessListener { users ->
//                    if (users.isEmpty()) return@addOnSuccessListener
//                    val contactIds = users.first().get("contacts") as? List<String> ?: emptyList()
//
//                    for (contactId in contactIds) {
//                        db.collection("Users").document(contactId).get()
//                            .addOnSuccessListener { doc ->
//                                val username = doc.getString("username") ?: ""
//                                val cb = CheckBox(this).apply {
//                                    text = "@$username"
//                                    textSize = 16f
//                                    setPadding(8, 12, 8, 12)
//                                    setOnCheckedChangeListener { _, isChecked ->
//                                        if (isChecked) selectedContacts.add(username)
//                                        else selectedContacts.remove(username)
//                                    }
//                                }
//                                contactsContainer.addView(cb)
//                            }
//                    }
//                }
//
//            AlertDialog.Builder(this)
//                .setTitle("Создать группу")
//                .setView(container)
//                .setPositiveButton("Создать") { _, _ ->
//                    val groupName = etGroupName.text.toString().trim()
//
//                    if (groupName.isEmpty()) {
//                        Toast.makeText(this, "Введите название группы", Toast.LENGTH_SHORT).show()
//                        return@setPositiveButton
//                    }
//
//                    if (selectedContacts.isEmpty()) {
//                        Toast.makeText(this, "Выберите хотя бы одного участника", Toast.LENGTH_SHORT).show()
//                        return@setPositiveButton
//                    }
//
//                    val allMembers = selectedContacts.toList() + currentUsername
//                    val groupId = db.collection("Groups").document().id
//
//                    val groupData = hashMapOf<String, Any>(
//                        "name" to groupName,
//                        "members" to allMembers,
//                        "lastMsg" to "",
//                        "lastread" to 0,
//                        "time" to System.currentTimeMillis()
//                    )
//
//                    db.collection("Groups").document(groupId).set(groupData)
//                        .addOnSuccessListener {
//                            for (member in allMembers) {
//                                db.collection("Users").whereEqualTo("username", member).get()
//                                    .addOnSuccessListener { userDocs ->
//                                        if (userDocs.isEmpty()) return@addOnSuccessListener
//                                        val userDoc = userDocs.first()
//                                        val currentChats = userDoc.get("chats") as? List<String> ?: emptyList()
//                                        if (!currentChats.contains(groupId)) {
//                                            userDoc.reference.update("chats", currentChats + groupId)
//                                        }
//                                    }
//                            }
//                            Toast.makeText(this, "Группа \"$groupName\" создана", Toast.LENGTH_SHORT).show()
//                        }
//                        .addOnFailureListener { e ->
//                            Toast.makeText(this, "Ошибка: ${e.message}", Toast.LENGTH_SHORT).show()
//                        }
//                }
//                .setNegativeButton("Отмена", null)
//                .show()
//        }

        binding.btnCreateChat.setOnClickListener {
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
//                        db.collection("Users").whereEqualTo("username", otherUser).get()
//                            .addOnSuccessListener { users ->
//                                if (users.isEmpty()) {
//                                    Toast.makeText(this, "Пользователь не найден", Toast.LENGTH_SHORT).show()
//                                    return@addOnSuccessListener
//                                }
//
//                                db.collection("LS").whereArrayContains("members", currentUsername).get()
//                                    .addOnSuccessListener { chats ->
//                                        var chatId = ""
//                                        for (doc in chats) {
//                                            val members = doc.get("members") as? List<*> ?: emptyList<Any>()
//                                            if (members.contains(otherUser)) {
//                                                chatId = doc.id
//                                                break
//                                            }
//                                        }
//
//                                        if (chatId.isEmpty()) {
//                                            // Создаём новый чат
//                                            chatId = db.collection("LS").document().id
//                                            val members = listOf(currentUsername, otherUser)
//                                            db.collection("LS").document(chatId).set(
//                                                mapOf("members" to members, "lastMsg" to "", "time" to System.currentTimeMillis())
//                                            ).addOnSuccessListener {
//                                                // Добавляем чат пользователям
//                                                listOf(currentUsername, otherUser).forEach { user ->
//                                                    db.collection("Users").whereEqualTo("username", user).get()
//                                                        .addOnSuccessListener { userDocs ->
//                                                            if (userDocs.isEmpty()) return@addOnSuccessListener
//                                                            val userDoc = userDocs.first()
//                                                            val currentChats = userDoc.get("chats") as? List<String> ?: emptyList()
//                                                            if (!currentChats.contains(chatId)) {
//                                                                userDoc.reference.update("chats", currentChats + chatId)
//                                                            }
//                                                        }
//                                                }
//                                            }
//                                        }
//
//                                        // Открываем чат
//                                        startActivity(Intent(this, Chat::class.java).apply {
//                                            putExtra("chatId", chatId)
//                                            putExtra("otherUsername", otherUser)
//                                            putExtra("currentUsername", currentUsername)
//                                        })
//                                    }
//                            }
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
//        db.collection("Users")
//            .whereEqualTo("username", currentUsername)
//            .get()
//            .addOnSuccessListener { users ->
//                if (users.isEmpty()) {
//                    binding.tvNoContacts.visibility = View.VISIBLE
//                    binding.rvContacts.visibility = View.GONE
//                    return@addOnSuccessListener
//                }
//
//                val user = users.first().toObject(User::class.java)
//                // Фильтруем пустые ID
//                val contactIds = user.contacts.filter { it.isNotBlank() }
//
//                if (contactIds.isEmpty()) {
//                    binding.tvNoContacts.visibility = View.VISIBLE
//                    binding.rvContacts.visibility = View.GONE
//                    return@addOnSuccessListener
//                }
//
//                contactsList.clear()
//                var loadedCount = 0
//
//                for (contactId in contactIds) {
//                    db.collection("Users").document(contactId)
//                        .get()
//                        .addOnSuccessListener { doc ->
//                            val username = doc.getString("username") ?: ""
//                            val nickname = doc.getString("nickname") ?: ""
//                            val avatarUrl = doc.getString("avatarUrl") ?: ""
//                            val displayName = if (nickname.isNotEmpty()) nickname else username
//                            contactsList.add(Contact(displayName, contactId, username, avatarUrl))
//                            contactsAdapter.notifyDataSetChanged()
//                            binding.tvNoContacts.visibility = View.GONE
//                            binding.rvContacts.visibility = View.VISIBLE
//                        }
//                }
//            }
//            .addOnFailureListener {
//                Toast.makeText(this, "Ошибка загрузки контактов", Toast.LENGTH_SHORT).show()
//            }
    }

//    private fun openChatWithContact(contact: Contact) {
////        db.collection("LS")
////            .whereArrayContains("members", currentUsername)
////            .get()
////            .addOnSuccessListener { chats ->
////                var existingChatId: String? = null
////                var userIndex = 0
////
////                for (doc in chats) {
////                    val members = doc.get("members") as? List<*> ?: emptyList<Any>()
////                    if (members.contains(contact.username)) {
////                        existingChatId = doc.id
////                        userIndex = members.indexOf(currentUsername)
////                        break
////                    }
////                }
////
////                val intent = Intent(this, Chat::class.java).apply {
////                    if (existingChatId != null) {
////                        putExtra("chatId", existingChatId)
////                        putExtra("userIndex", userIndex)
////                    }
////                    putExtra("chatTitle", contact.username)
////                    putExtra("otherUsername", contact.username)
////                    putExtra("currentUsername", currentUsername)
////                }
////                startActivity(intent)
////                finish()
////            }
////            .addOnFailureListener {
////                Toast.makeText(this, "Ошибка", Toast.LENGTH_SHORT).show()
////            }
//    }
}