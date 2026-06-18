package com.example.messenger.domain.viewmodels

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.LocalRepository
import kotlinx.coroutines.launch

class ContactsViewModel(
    private val repository: LocalRepository
) : ViewModel() {

    private val _contacts = MutableLiveData<List<ContactEntity>>()
    val contacts: LiveData<List<ContactEntity>> = _contacts

    fun loadContacts(userId: Int) {
        viewModelScope.launch {
            val contactsData = repository.getContactsWithFallback(userId)
            _contacts.value = contactsData
        }
    }

    fun addContact(userId: Int, username: String) {
        viewModelScope.launch {
            repository.addContactWithFallback(userId, username)
            loadContacts(userId)
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            repository.clearAllData()
        }
    }
}