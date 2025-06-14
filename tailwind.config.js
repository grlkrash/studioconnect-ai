module.exports = {
  content: [
    './views/**/*.ejs',
    './src/views/**/*.ejs'
  ],
  theme: {
    extend: {
      colors: {
        brand: '#7c3aed'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio')
  ]
} 