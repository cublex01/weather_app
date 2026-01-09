const apiUrl = 'https://api.openweathermap.org/data/2.5/weather?units=metric&q=';
const apiKey = 'ec4554fd85fadf8628ecc6f24fa1d678';

const cityInput = document.getElementById('cityInput');
const submitBtn = document.getElementById('submitBtn');
const temp = document.getElementById('temp');
const humidity = document.getElementById('humidity');
const windSpeed = document.getElementById('windSpeed');

submitBtn.addEventListener('click', function() {
    const city = cityInput.value;
    fetchWeatherData(city);
});

function fetchWeatherData(city) {
    fetch(apiUrl + city + '&appid=' + apiKey)
        .then(response => response.json())
        .then(data => {
            temp.textContent = Math.round(data.main.temp) + '°C';
            humidity.textContent = data.main.humidity;
            windSpeed.textContent = data.wind.speed + ' m/s';
        })
} 