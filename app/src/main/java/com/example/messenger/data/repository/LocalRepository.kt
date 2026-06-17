package com.example.messenger.data.repository

import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.local.entities.UserEntity

class LocalRepository(private val db: AppDatabase) {

    // ===== Users =====
    suspend fun saveUser(user: UserEntity) = db.userDao().insertUser(user)
    suspend fun getUser(userId: Int) = db.userDao().getUser(userId)

    // ===== Contacts =====
    suspend fun saveContacts(contacts: List<ContactEntity>) = db.contactDao().insertAllContacts(contacts)
    suspend fun getAllContacts() = db.contactDao().getAllContacts()
    suspend fun clearContacts() = db.contactDao().deleteAllContacts()

    // ===== Полная очистка =====
    suspend fun clearAllData() {
        db.userDao().deleteAllUsers()
        db.contactDao().deleteAllContacts()
        // db.chatDao().deleteAllChats()
    }
}