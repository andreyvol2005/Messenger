package com.example.messenger.UI.Fragments

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.content.edit
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import com.example.messenger.UI.Registration
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.LocalRepository
import com.example.messenger.databinding.FragmentProfileBinding
import com.example.messenger.domain.viewmodels.ProfileViewModel

class Profile : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }

    private val viewModel: ProfileViewModel by viewModels {
        object : androidx.lifecycle.ViewModelProvider.Factory {
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
                val db = AppDatabase.getDatabase(requireContext())
                val repository = LocalRepository(db)
                return ProfileViewModel(repository) as T
            }
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        viewModel.user.observe(viewLifecycleOwner) { user ->
            user?.let { displayUser(it) }
        }

        viewModel.loadUser(prefs.getInt("user_id", 0))

        binding.btnLogout.setOnClickListener {
            viewModel.clearAllData()
            prefs.edit { clear() }
            startActivity(Intent(requireContext(), Registration::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            })
        }
    }

    private fun displayUser(user: UserEntity) {
        binding.tvDisplayName.text = user.nickname.ifEmpty { user.username }
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