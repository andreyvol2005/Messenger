package com.example.messenger.UI.Fragments

import android.Manifest
import android.app.Activity
import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.example.messenger.R
import com.example.messenger.UI.Registration
import com.example.messenger.data.local.database.AppDatabase
import com.example.messenger.data.local.entities.UserEntity
import com.example.messenger.data.repository.LocalRepository
import com.example.messenger.databinding.FragmentProfileBinding
import com.example.messenger.network.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Calendar

class Profile : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    private lateinit var localRepository: LocalRepository

    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", Context.MODE_PRIVATE) }
    private var currentUserId: Int = 0
    private var currentUsername: String = ""
    private val API_KEY = "6d207e02198a847aa98d0a2a901485a5"

    private val PICK_IMAGE_REQUEST = 1000
    private val PERMISSION_REQUEST_CODE = 100

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUsername = prefs.getString("username", "") ?: ""
        currentUserId = prefs.getInt("user_id", 0)

        if (currentUserId == 0 || currentUsername.isEmpty()) {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        // Инициализация Room
        val db = AppDatabase.getDatabase(requireContext())
        localRepository = LocalRepository(db)

        loadUserProfile()

        binding.editAvatar.setOnClickListener {
            openImageChooser()
        }

        binding.editUsername.setOnClickListener {
            val currentValue = binding.tvUsername.text.toString()
            showEditDialog("Изменить username", currentValue) { newValue ->
                if (newValue.length < 3) {
                    Toast.makeText(requireContext(), "Username должен быть не менее 3 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.length > 20) {
                    Toast.makeText(requireContext(), "Username должен быть не более 20 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (!newValue.matches(Regex("^[a-zA-Z0-9._]+$"))) {
                    Toast.makeText(requireContext(), "Username может содержать только буквы, цифры, . и _", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                // Проверка на существование через API
                lifecycleScope.launch {
                    try {
                        // TODO: добавить эндпоинт для проверки username
                        updateUserField("username", newValue)
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(requireContext(), "Ошибка: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
        }

        binding.editNickname.setOnClickListener {
            val currentValue = binding.tvNickname.text.toString()
            showEditDialog("Изменить отображаемое имя", currentValue) { newValue ->
                if (newValue.isEmpty()) {
                    Toast.makeText(requireContext(), "Отображаемое имя не может быть пустым", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.length > 30) {
                    Toast.makeText(requireContext(), "Отображаемое имя должно быть не более 30 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.trim().isEmpty()) {
                    Toast.makeText(requireContext(), "Имя не может состоять только из пробелов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                updateUserField("nickname", newValue)
                binding.tvDisplayName.text = newValue
            }
        }

        binding.editBio.setOnClickListener {
            val currentValue = binding.tvBio.text.toString()
            showEditDialog("Изменить описание", currentValue) { newValue ->
                if (newValue.length > 150) {
                    Toast.makeText(requireContext(), "Описание должно быть не более 150 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                val finalValue = if (newValue.isEmpty()) "Нет описания" else newValue
                updateUserField("bio", finalValue)
            }
        }

        binding.editBirthDate.setOnClickListener {
            showDatePickerDialog()
        }

        binding.btnLogout.setOnClickListener {
            prefs.edit().clear().apply()
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

                // 3. Сохраняем в локальную БД
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

                // 4. Обновляем UI, если изменилось
                withContext(Dispatchers.Main) {
                    displayUser(userEntity)
                }
            } catch (e: Exception) {
                // Если нет интернета, просто используем данные из Room
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

        if (!user.avatarUrl.isNullOrEmpty()) {
            Glide.with(requireContext())
                .load(user.avatarUrl)
                .placeholder(R.drawable.ic_avatar_default)
                .error(R.drawable.ic_avatar_default)
                .into(binding.ivAvatar)
        } else {
            binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
        }
    }

    private fun openImageChooser() {
        if (ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.READ_MEDIA_IMAGES)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(requireActivity(),
                arrayOf(Manifest.permission.READ_MEDIA_IMAGES),
                PERMISSION_REQUEST_CODE)
        } else {
            val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
            intent.type = "image/*"
            startActivityForResult(intent, PICK_IMAGE_REQUEST)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                openImageChooser()
            } else {
                Toast.makeText(requireContext(), "Нужно разрешение для выбора изображения", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_IMAGE_REQUEST && resultCode == Activity.RESULT_OK && data != null) {
            val selectedImageUri = data.data
            selectedImageUri?.let { uri ->
                val filePath = getRealPathFromURI(uri)
                filePath?.let { path ->
                    uploadImageToHost(File(path))
                }
            }
        }
    }

    private fun getRealPathFromURI(contentUri: Uri): String? {
        val filePathColumn = arrayOf(MediaStore.Images.Media.DATA)
        val cursor: Cursor? = requireContext().contentResolver.query(contentUri, filePathColumn, null, null, null)
        cursor?.use {
            val columnIndex = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
            it.moveToFirst()
            return it.getString(columnIndex)
        }
        return null
    }

    private fun uploadImageToHost(imageFile: File) {
        if (_binding == null) return
        val compressedFile = compressImage(imageFile)

        Toast.makeText(requireContext(), "Загрузка изображения...", Toast.LENGTH_SHORT).show()

        val client = OkHttpClient()
        val mediaType = "image/*".toMediaType()
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("key", API_KEY)
            .addFormDataPart("action", "upload")
            .addFormDataPart("source", compressedFile.name, compressedFile.asRequestBody(mediaType))
            .addFormDataPart("format", "json")
            .build()

        val request = Request.Builder()
            .url("https://freeimage.host/api/1/upload")
            .post(requestBody)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                requireActivity().runOnUiThread {
                    Toast.makeText(requireContext(), "Ошибка сети: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string()
                requireActivity().runOnUiThread {
                    if (response.isSuccessful && responseBody != null) {
                        try {
                            val json = JSONObject(responseBody)
                            val imageUrl = json.optJSONObject("image")?.optString("url")
                            if (!imageUrl.isNullOrEmpty()) {
                                updateUserField("avatarUrl", imageUrl)
                                Glide.with(requireContext()).load(imageUrl).into(binding.ivAvatar)
                            } else {
                                Toast.makeText(requireContext(), "Не удалось получить ссылку", Toast.LENGTH_SHORT).show()
                            }
                        } catch (e: Exception) {
                            Toast.makeText(requireContext(), "Ошибка обработки: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        Toast.makeText(requireContext(), "Ошибка загрузки", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun compressImage(imageFile: File): File {
        val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, outputStream)

        val compressedFile = File(requireContext().cacheDir, "compressed_${System.currentTimeMillis()}.jpg")
        FileOutputStream(compressedFile).write(outputStream.toByteArray())
        return compressedFile
    }

    private fun showEditDialog(title: String, currentValue: String, onSave: (String) -> Unit) {
        val input = EditText(requireContext()).apply {
            setText(currentValue)
            hint = "Введите новое значение"
        }

        AlertDialog.Builder(requireContext())
            .setTitle(title)
            .setView(input)
            .setPositiveButton("Сохранить") { _, _ ->
                val newValue = input.text.toString().trim()
                if (newValue.isNotEmpty() && newValue != currentValue) {
                    onSave(newValue)
                } else if (newValue.isEmpty()) {
                    Toast.makeText(requireContext(), "Поле не может быть пустым", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun showDatePickerDialog() {
        if (_binding == null) return
        val calendar = Calendar.getInstance()
        val currentDate = binding.tvBirthDate.text.toString()

        if (currentDate != "Не указана" && currentDate != "...") {
            try {
                val parts = currentDate.split(".")
                if (parts.size == 3) {
                    calendar.set(parts[2].toInt(), parts[1].toInt() - 1, parts[0].toInt())
                }
            } catch (e: Exception) { }
        }

        DatePickerDialog(
            requireContext(),
            { _, year, month, dayOfMonth ->
                val newDate = String.format("%02d.%02d.%d", dayOfMonth, month + 1, year)
                updateUserField("birthDate", newDate)
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun updateUserField(field: String, value: String) {
        lifecycleScope.launch {
            try {
                // 1. Отправляем запрос на сервер
                val api = RetrofitClient.apiService
                // TODO: добавить эндпоинт для обновления пользователя
                // api.updateUser(currentUserId, mapOf(field to value))

                // 2. Обновляем локальную БД
                val currentUser = localRepository.getUser(currentUserId)
                if (currentUser != null) {
                    val updatedUser = when (field) {
                        "username" -> currentUser.copy(username = value)
                        "nickname" -> currentUser.copy(nickname = value)
                        "bio" -> currentUser.copy(bio = value)
                        "birthDate" -> currentUser.copy(birthDate = value)
                        "avatarUrl" -> currentUser.copy(avatarUrl = value)
                        else -> currentUser
                    }
                    localRepository.saveUser(updatedUser)

                    withContext(Dispatchers.Main) {
                        Toast.makeText(requireContext(), "Обновлено", Toast.LENGTH_SHORT).show()
                        loadUserProfile()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(requireContext(), "Ошибка обновления: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}