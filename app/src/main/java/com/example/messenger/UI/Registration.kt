package com.example.messenger.UI

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.messenger.databinding.ActivityRegistrationBinding
import com.example.messenger.data.network.LoginRequest
import com.example.messenger.data.network.RegisterRequest
import com.example.messenger.data.network.RetrofitClient
import com.example.messenger.utils.PreferencesManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class Registration : AppCompatActivity() {

    private lateinit var binding: ActivityRegistrationBinding
    private val api = RetrofitClient.apiService
    private lateinit var prefs: PreferencesManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRegistrationBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = PreferencesManager(this)

        if (prefs.getUserId() != -1) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }

        binding.btnRegister.setOnClickListener {
            val username = binding.etUsername.text.toString().trim()
            val password = binding.etPassword.text.toString().trim()
            if (username.isNotEmpty() && password.isNotEmpty()) registerUser(username, password)
            else Toast.makeText(this, "Заполните все поля", Toast.LENGTH_SHORT).show()
        }

        binding.btnLogin.setOnClickListener {
            val username = binding.etUsername.text.toString().trim()
            val password = binding.etPassword.text.toString().trim()
            if (username.isNotEmpty() && password.isNotEmpty()) loginUser(username, password)
            else Toast.makeText(this, "Введите логин и пароль", Toast.LENGTH_SHORT).show()
        }
    }

    private fun registerUser(username: String, password: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = api.register(RegisterRequest(username, password))
                withContext(Dispatchers.Main) {
                    prefs.saveUserId(response.userId)
                    startActivity(Intent(this@Registration, MainActivity::class.java))
                    finish()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@Registration,
                        "Ошибка: ${e.message}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }

    private fun loginUser(username: String, password: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = api.login(LoginRequest(username, password))
                withContext(Dispatchers.Main) {
                    prefs.saveUserId(response.userId)
                    startActivity(Intent(this@Registration, MainActivity::class.java))
                    finish()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@Registration,
                        "Ошибка: ${e.message}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        }
    }
}