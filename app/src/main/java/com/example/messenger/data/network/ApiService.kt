package com.example.messenger.data.network

import com.example.messenger.data.models.ContactDto
import com.example.messenger.data.models.User
import retrofit2.http.*

interface ApiService {

    // ===== Аутентификация =====
    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): AuthResponse

    // ===== Пользователи =====
    @GET("users/{userId}")
    suspend fun getUser(@Path("userId") userId: Int): User

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
    ): User
}