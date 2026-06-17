package com.example.messenger.data.repository

import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.*

class LocalRepository(private val db: AppDatabase) {

    // ===== Users =====
    suspend fun saveUser(user: UserEntity) = db.userDao().insertUser(user)
    suspend fun getUser(userId: Int) = db.userDao().getUser(userId)
    suspend fun clearAllData() = db.userDao().deleteAllUsers()

//    // ===== Chats =====
//    suspend fun saveChats(chats: List<ChatEntity>) = db.chatDao().insertAllChats(chats)
//    suspend fun getAllChats() = db.chatDao().getAllChats()
//    suspend fun clearChats() = db.chatDao().deleteAllChats()
//
//    // ===== Messages =====
//    suspend fun saveMessages(messages: List<MessageEntity>) = db.messageDao().insertAllMessages(messages)
//    suspend fun getMessagesForChat(chatId: Int) = db.messageDao().getMessagesForChat(chatId)
//    suspend fun markMessagesAsRead(chatId: Int, userId: Int) = db.messageDao().markMessagesAsRead(chatId, userId)
//    suspend fun clearMessages(chatId: Int) = db.messageDao().deleteMessagesForChat(chatId)
//
//    // ===== Contacts =====
//    suspend fun saveContacts(contacts: List<ContactEntity>) = db.contactDao().insertAllContacts(contacts)
//    suspend fun getAllContacts() = db.contactDao().getAllContacts()
//    suspend fun clearContacts() = db.contactDao().deleteAllContacts()
//
//    // ===== Полная очистка =====
//    suspend fun clearAllData() {
//        db.userDao().deleteAllUsers()
//        db.chatDao().deleteAllChats()
//        db.contactDao().deleteAllContacts()
//        // messages удаляются через cascade или отдельно
//    }
}