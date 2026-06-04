package com.example.messenger.DataClasses

sealed class ChatItem {
    data class Private(val chat: LS) : ChatItem()
    data class Group(val group: GroupChat) : ChatItem()
}
