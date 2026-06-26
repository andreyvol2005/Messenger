package com.example.messenger.network

import com.example.messenger.data.models.ChatDto
import com.example.messenger.data.models.ContactDto
import com.example.messenger.data.models.MessageDto
import com.example.messenger.data.models.MessageResponse
import com.example.messenger.data.models.SendMessageRequest
import com.example.messenger.data.models.UserDto
import retrofit2.http.*

interface ApiService {

    // ===== Аутентификация =====
    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): AuthResponse

    // ===== Пользователи =====
    @GET("users/{userId}")
    suspend fun getUser(@Path("userId") userId: Int): UserDto

    // ===== Контакты =====
    @GET("contacts/{userId}")
    suspend fun getContacts(
        @Path("userId") userId: Int
    ): List<ContactDto>

    @POST("contacts")
    suspend fun addContact(
        @Query("user_id") userId: Int,
        @Body request: AddContactRequest
    ): ContactResponse

    @GET("users/by-username/{username}")
    suspend fun getUserByUsername(
        @Path("username") username: String
    ): UserDto

    // ===== Чаты =====
    @GET("chats/user/{userId}")
    suspend fun getUserChats(
        @Path("userId") userId: Int
    ): List<ChatDto>

    @POST("chats")
    suspend fun createChat(
        @Query("user_id") userId: Int,
        @Query("type") type: String = "private",
        @Query("partner_username") partnerUsername: String
    ): ChatDto

    @GET("messages/chat/{chatId}")
    suspend fun getChatMessages(
        @Path("chatId") chatId: Int,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): List<MessageDto>

    @POST("messages")
    suspend fun sendMessage(
        @Body request: SendMessageRequest
    ): MessageResponse
}