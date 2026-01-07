import React from 'react';
import Logo from './Logo';

export default function Header() {
    return (
        <header className="w-full py-8 mb-8 shadow-md" style={{ backgroundColor: '#2f4a44' }}>
            <div className="container mx-auto flex justify-center" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                <Logo />
            </div>
        </header>
    );
}
