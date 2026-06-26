package com.example.messenger.domain.viewmodels

import android.util.Log
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.messenger.data.LocalRepository
import com.example.messenger.data.local.entities.MessageEntity
import com.example.messenger.data.models.UserDto
import kotlinx.coroutines.launch

class ChatViewModel(
    private val repository: LocalRepository
) : ViewModel() {

    private val _messages = MutableLiveData<List<MessageEntity>>()
    val messages: LiveData<List<MessageEntity>> = _messages

    private val _chatTitle = MutableLiveData<String>()
    val chatTitle: LiveData<String> = _chatTitle

    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    fun loadMessages(chatId: Int) {
        viewModelScope.launch {
            try {
                val messages = repository.getMessagesWithFallback(chatId)
                Log.d("ChatViewModel", "Загружено сообщений: ${messages.size}")
                _messages.value = messages
            } catch (e: Exception) {
                Log.e("ChatViewModel", "Ошибка загрузки: ${e.message}")
                _error.value = e.message
            }
        }
    }

    fun sendMessage(chatId: Int, senderId: Int, text: String) {
        viewModelScope.launch {
            try {
                val success = repository.sendMessage(chatId, senderId, text)
                if (success) {
                    // Перезагружаем сообщения
                    loadMessages(chatId)
                } else {
                    _error.value = "Не удалось отправить сообщение"
                }
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun loadChatTitle(otherUsername: String) {
        viewModelScope.launch {
            val user = repository.getUserByUsername(otherUsername)
            _chatTitle.value = user?.nickname ?: otherUsername
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            repository.clearAllData()
        }
    }
}