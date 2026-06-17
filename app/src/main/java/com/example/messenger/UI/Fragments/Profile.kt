package com.example.messenger.UI.Fragments

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.example.messenger.UI.Registration
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.repository.LocalRepository
import com.example.messenger.databinding.FragmentProfileBinding
import com.example.messenger.data.network.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.core.content.edit

class Profile : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    private lateinit var localRepository: LocalRepository
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    private var currentUserId: Int = 0

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUserId = prefs.getInt("user_id", 0)

        // Инициализация Room
        val db = AppDatabase.getDatabase(requireContext())
        localRepository = LocalRepository(db)

        loadUserProfile()

        // TODO: Редактирование профиля
        // binding.editUsername.setOnClickListener { ... }
        // binding.editNickname.setOnClickListener { ... }
        // binding.editBio.setOnClickListener { ... }
        // binding.editBirthDate.setOnClickListener { ... }

        binding.btnLogout.setOnClickListener {
            lifecycleScope.launch {
                localRepository.clearAllData()
            }
            prefs.edit { clear() }
            val intent = Intent(requireContext(), Registration::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(intent)
            Toast.makeText(requireContext(), "Вы вышли из аккаунта", Toast.LENGTH_SHORT).show()
        }
    }

    private fun loadUserProfile() {
        lifecycleScope.launch {
            // 1. Сначала пробуем загрузить из локальной БД
            val localUser = localRepository.getUser(currentUserId)

            if (localUser != null) {
                displayUser(localUser)
            }

            // 2. Обновляем с сервера (в фоне)
            try {
                val api = RetrofitClient.apiService
                val user = api.getUser(currentUserId)

                val userEntity = UserEntity(
                    id = user.id,
                    username = user.username,
                    nickname = user.nickname,
                    bio = user.bio,
                    birthDate = user.birthDate,
                    avatarUrl = user.avatarUrl,
                    createdAt = user.createdAt
                )
                localRepository.saveUser(userEntity)

                withContext(Dispatchers.Main) {
                    displayUser(userEntity)
                }
            } catch (e: Exception) {
                if (localUser == null) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(requireContext(), "Ошибка загрузки профиля", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun displayUser(user: UserEntity) {
        val displayName = user.nickname.ifEmpty { user.username }
        binding.tvDisplayName.text = displayName
        binding.tvUsername.text = user.username
        binding.tvNickname.text = user.nickname.ifEmpty { "Не указано" }
        binding.tvBio.text = user.bio ?: "Нет описания"
        binding.tvBirthDate.text = user.birthDate ?: "Не указана"
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}