package com.example.messenger.domain.viewmodels

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.LocalRepository
import kotlinx.coroutines.launch

class ProfileViewModel(
    private val repository: LocalRepository
) : ViewModel() {

    private val _user = MutableLiveData<UserEntity?>()
    val user: LiveData<UserEntity?> = _user

    fun loadUser(userId: Int) {
        viewModelScope.launch {
            val userData = repository.getUserWithFallback(userId)
            _user.value = userData
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            repository.clearAllData()
        }
    }
}