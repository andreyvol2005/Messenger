package com.example.messenger.data

import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.network.RetrofitClient

class LocalRepository(
    private val db: AppDatabase
) {

    // ===== Users =====
    suspend fun saveUser(user: UserEntity) = db.userDao().insertUser(user)
    suspend fun getUser(userId: Int) = db.userDao().getUser(userId)

    suspend fun getUserWithFallback(userId: Int): UserEntity? {
        return getUser(userId) ?: try {
            val userDto = RetrofitClient.apiService.getUser(userId)
            UserEntity(
                id = userDto.id,
                username = userDto.username,
                nickname = userDto.nickname,
                bio = userDto.bio,
                birthDate = userDto.birthDate,
                avatarUrl = userDto.avatarUrl,
                createdAt = userDto.createdAt
            ).also { saveUser(it) }
        } catch (e: Exception) {
            null
        }
    }

    // ===== Contacts =====
    suspend fun saveContacts(contacts: List<ContactEntity>) = db.contactDao().insertAllContacts(contacts)
    suspend fun getAllContacts() = db.contactDao().getAllContacts()

    // ===== Chats =====
    suspend fun saveChats(chats: List<ChatEntity>) = db.chatDao().insertAllChats(chats)
    suspend fun getAllChats() = db.chatDao().getAllChats()

    // ===== Полная очистка =====
    suspend fun clearAllData() {
        db.userDao().deleteAllUsers()
        db.contactDao().deleteAllContacts()
        db.chatDao().deleteAllChats()
    }
}