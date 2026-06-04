package com.example.messenger.DataClasses

data class LS(
    val id: String = "",
    val members: List<String> = emptyList(),
    val lastMsg: String = "",
    val lastread: Int = 0,
    val time: Long = 0L,
    val partnerNickname: String = "",
    val partnerAvatarUrl: String = "",
    val unreadCount: Int = 0,
    val unread: Int = 0,
    val lastSender: String = ""
)
