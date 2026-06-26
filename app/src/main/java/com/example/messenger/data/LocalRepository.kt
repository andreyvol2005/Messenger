package com.example.messenger.data

import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.local.entities.MessageEntity
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.models.SendMessageRequest
import com.example.messenger.data.models.UserDto
import com.example.messenger.network.AddContactRequest
import com.example.messenger.network.RetrofitClient

class LocalRepository(
    private val db: AppDatabase
) {

    // ===== Users =====
    suspend fun saveUser(user: UserEntity) = db.userDao().insertUser(user)
    suspend fun getUser(userId: Int) = db.userDao().getUser(userId)
    suspend fun getUserByUsername(username: String): UserDto? {
        return try {
            RetrofitClient.apiService.getUserByUsername(username)
        } catch (e: Exception) {
            null
        }
    }

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
    suspend fun getContactsForDialog(): List<ContactEntity> {
        return db.contactDao().getAllContacts()
    }
    suspend fun getContactsWithFallback(userId: Int): List<ContactEntity> {
        return db.contactDao().getAllContacts().takeIf { it.isNotEmpty() } ?: try {
            RetrofitClient.apiService.getContacts(userId).map {
                ContactEntity(
                    id = it.id,
                    username = it.username,
                    nickname = it.nickname,
                    avatarUrl = it.avatarUrl
                )
            }.also { db.contactDao().insertAllContacts(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun addContactWithFallback(userId: Int, username: String): Boolean {
        return try {
            val user = RetrofitClient.apiService.getUserByUsername(username)
            RetrofitClient.apiService.addContact(userId, AddContactRequest(user.id))
            db.contactDao().insertAllContacts(
                listOf(
                    ContactEntity(
                        id = user.id,
                        username = user.username,
                        nickname = user.nickname,
                        avatarUrl = user.avatarUrl
                    )
                )
            )
            true
        } catch (e: Exception) {
            false
        }
    }
    suspend fun saveContacts(contacts: List<ContactEntity>) = db.contactDao().insertAllContacts(contacts)
    suspend fun getAllContacts() = db.contactDao().getAllContacts()

    // ===== Chats =====
    data class ChatCreationResult(
        val chatId: Int,
        val partnerNickname: String
    )

    suspend fun findOrCreatePrivateChat(userId: Int, otherUsername: String): ChatCreationResult {
        val api = RetrofitClient.apiService

        // 1. Ищем существующий чат
        val chats = api.getUserChats(userId)
        val existingChat = chats.find {
            it.type == "private" && it.partner?.username == otherUsername
        }

        if (existingChat != null) {
            val partnerNickname = existingChat.partner?.nickname ?: otherUsername
            return ChatCreationResult(existingChat.id, partnerNickname)
        }

        // 2. Создаём новый чат
        val newChat = api.createChat(
            userId = userId,
            type = "private",
            partnerUsername = otherUsername
        )

        // Получаем ник партнёра
        val partner = api.getUserByUsername(otherUsername)
        val partnerNickname = partner?.nickname ?: otherUsername

        return ChatCreationResult(newChat.id, partnerNickname)
    }
    suspend fun getChatsWithFallback(userId: Int): List<ChatEntity> {
        return db.chatDao().getAllChats().takeIf { it.isNotEmpty() } ?: try {
            RetrofitClient.apiService.getUserChats(userId).map {
                ChatEntity(
                    id = it.id,
                    type = it.type,
                    name = it.name,
                    lastMessageText = it.lastMessage?.text,
                    lastMessageTime = it.lastMessage?.createdAt?.let { parseTime(it) },
                    partnerId = it.partner?.id,
                    partnerUsername = it.partner?.username,
                    partnerNickname = it.partner?.nickname,
                    partnerAvatarUrl = it.partner?.avatarUrl,
                    unreadCount = it.unreadCount,
                    createdAt = null
                )
            }.also { db.chatDao().insertAllChats(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun parseTime(timeString: String): Long? {
        return try {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSSSS", java.util.Locale.getDefault())
                .parse(timeString)?.time
        } catch (e: Exception) {
            try {
                java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSSSS", java.util.Locale.getDefault())
                    .parse(timeString)?.time
            } catch (e2: Exception) {
                null
            }
        }
    }
    suspend fun saveChats(chats: List<ChatEntity>) = db.chatDao().insertAllChats(chats)
    suspend fun getAllChats() = db.chatDao().getAllChats()

    // ===== Messages =====
    suspend fun getMessagesWithFallback(chatId: Int): List<MessageEntity> {
        val cached = db.messageDao().getMessagesForChat(chatId)
        if (cached.isNotEmpty()) {
            return cached
        }

        return try {
            val api = RetrofitClient.apiService
            val messages = api.getChatMessages(chatId)
            val entities = messages.map {
                MessageEntity(
                    id = it.id,
                    chatId = it.chatId,
                    senderId = it.senderId,
                    text = it.text,
                    mediaUrl = it.mediaUrl,
                    createdAt = it.createdAt,
                    replyToId = it.replyToId,
                    isDeleted = it.isDeleted,
                    isRead = it.isRead
                )
            }
            db.messageDao().insertAllMessages(entities)
            entities
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun sendMessage(chatId: Int, senderId: Int, text: String): Boolean {
        return try {
            val api = RetrofitClient.apiService
            val response = api.sendMessage(
                SendMessageRequest(
                    chatId = chatId,
                    senderId = senderId,
                    text = text
                )
            )
            // Обновляем последнее сообщение в чате
            db.chatDao().updateLastMessage(chatId, text)
            true
        } catch (e: Exception) {
            false
        }
    }

    // ===== Полная очистка =====
    suspend fun clearAllData() {
        db.userDao().deleteAllUsers()
        db.contactDao().deleteAllContacts()
        db.chatDao().deleteAllChats()
    }
}