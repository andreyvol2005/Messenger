package com.example.messenger.domain.viewmodels

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.messenger.data.LocalRepository
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.local.entities.ContactEntity
import kotlinx.coroutines.launch

class ChatsViewModel(
    private val repository: LocalRepository
) : ViewModel() {

    private val _chats = MutableLiveData<List<ChatEntity>>()
    val chats: LiveData<List<ChatEntity>> = _chats

    private val _contacts = MutableLiveData<List<ContactEntity>>()
    val contacts: LiveData<List<ContactEntity>> = _contacts

    fun loadChats(userId: Int) {
        viewModelScope.launch {
            val chatsData = repository.getChatsWithFallback(userId)
            _chats.value = chatsData
        }
    }

    fun loadContacts() {
        viewModelScope.launch {
            val contacts = repository.getContactsForDialog()
            _contacts.value = contacts
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            repository.clearAllData()
        }
    }
}