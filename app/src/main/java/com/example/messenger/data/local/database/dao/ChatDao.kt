package com.example.messenger.data.local.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.example.messenger.data.local.entities.ChatEntity

@Dao
interface ChatDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAllChats(chats: List<ChatEntity>)

    @Query("SELECT * FROM chats ORDER BY lastMessageTime DESC")
    suspend fun getAllChats(): List<ChatEntity>

    @Query("SELECT * FROM chats WHERE id = :chatId")
    suspend fun getChat(chatId: Int): ChatEntity?

    @Query("DELETE FROM chats")
    suspend fun deleteAllChats()

    @Query("UPDATE chats SET lastMessageText = :text WHERE id = :chatId")
    suspend fun updateLastMessage(chatId: Int, text: String)
}