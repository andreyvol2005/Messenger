package com.example.messenger.domain.viewmodels

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.messenger.data.LocalRepository
import kotlinx.coroutines.launch

class ChatViewModel(
    private val repository: LocalRepository
) : ViewModel() {

    private val _chatTitle = MutableLiveData<String>()
    val chatTitle: LiveData<String> = _chatTitle

    private val _chatId = MutableLiveData<Int>()
    val chatId: LiveData<Int> = _chatId

    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading

    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error

    fun loadOrCreateChat(userId: Int, otherUsername: String) {
        _isLoading.value = true

        viewModelScope.launch {
            try {
                // Вся логика в Repository!
                val result = repository.findOrCreatePrivateChat(userId, otherUsername)
                _chatId.value = result.chatId
                _chatTitle.value = result.partnerNickname
            } catch (e: Exception) {
                _error.value = e.message
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            repository.clearAllData()
        }
    }
}